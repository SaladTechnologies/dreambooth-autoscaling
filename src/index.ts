import { ActiveJob, Env, LastTouchedJob } from './types';
import { listContainerGroupInstances, reallocateInstance, scaleToZero, startContainerGroup, getContainerGroup } from './salad';

async function getNumFailuresForInstance(env: Env, machineId: string) {
	const { keys } = await env.BANNED_WORKERS.list({ prefix: machineId });
	return keys.length;
}

async function getActiveJobs(env: Env): Promise<ActiveJob[]> {
	// console.log('getting active jobs');
	const { results } = await env.DB.prepare(
		"SELECT status, created_at, completed_at, last_heartbeat FROM TrainingJobs WHERE status IN ('running', 'pending') LIMIT ?;"
	).bind(parseInt(env.MAX_REPLICAS)).all();
	return results as ActiveJob[];
}

const lastTouchedQuery = `
SELECT last_heartbeat, completed_at, failed_at, canceled_at
FROM TrainingJobs
WHERE status NOT IN ('running', 'pending')
ORDER BY COALESCE(completed_at, failed_at, canceled_at, last_heartbeat) DESC
LIMIT 1;
`;

async function getLastTouchedJob(env: Env): Promise<LastTouchedJob | null> {
	// console.log('getting last touched job');
	const { results } = await env.DB.prepare(lastTouchedQuery).all();
	// console.log('last touched job', !!results.length);
	if (results.length === 0) {
		return null;
	}
	return results[0] as LastTouchedJob;
}

const recentlyTouchedQuery = `
SELECT status, created_at, completed_at, failed_at, canceled_at, last_heartbeat
FROM TrainingJobs
WHERE status NOT IN ('running', 'pending')
AND COALESCE(completed_at, failed_at, canceled_at, last_heartbeat) > datetime('now', '-' || ? || ' minutes')
`;

async function getJobsTouchedWithin(env: Env, minutes: number): Promise<LastTouchedJob[]> {
	// console.log('getting jobs touched within', minutes);
	const { results } = await env.DB.prepare(recentlyTouchedQuery).bind(minutes).all();
	// console.log(results.length, 'jobs touched within', minutes, 'minutes');
	return results as LastTouchedJob[];
}

async function reallocateBadInstances(env: Env) {
	const { instances } = await listContainerGroupInstances(env);
	const maxFailures = parseInt(env.MAX_FAILURES_PER_WORKER);
	let badInstances = await Promise.all(
		instances.map(async (instance) => {
			const numFailures = await getNumFailuresForInstance(env, instance.machine_id);
			if (numFailures >= maxFailures) {
				return instance.machine_id;
			}
		})
	);
	await Promise.all(
		badInstances
			.filter((id) => id)
			.map(async (id) => {
				await reallocateInstance(env, id as string);
			})
	);
}

async function scaleToReplicas(env: Env, replicas: number) {
	console.log('scaling to', replicas);
	const group = await getContainerGroup(env);
	const {
		current_state: { status },
	} = group;
	if (status === 'stopped' && replicas > 0) {
		await startContainerGroup(env);
	} else if (replicas === 0) {
		return scaleToZero(env);
	}
	if (group.replicas === replicas) {
		return; // Already at the desired number of replicas.
	}
	const url = `https://api.salad.com/api/public/organizations/${env.SALAD_ORG}/projects/${env.SALAD_PROJECT}/containers/${env.SALAD_CONTAINER_GROUP}`;
	console.log('PATCH', url);
	const response = await fetch(url, {
		method: 'PATCH',
		headers: {
			'Salad-Api-Key': env.SALAD_API_KEY,
			'Content-Type': 'application/merge-patch+json',
			Accept: 'application/json',
		},
		body: JSON.stringify({
			replicas,
		}),
	});
	if (!response.ok) {
		throw new Error(`Failed to scale container group: ${response.status}: ${response.statusText}: ${await response.text()}`);
	}
	return;
}

export default {
	// The scheduled handler is invoked at the interval set in our wrangler.toml's
	// [[triggers]] configuration.
	async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
		try {
			// Check to see if there are any active jobs
			const activeJobs = await getActiveJobs(env);
			const lastJob = await getLastTouchedJob(env);
			let lastTouch;
			if (lastJob) {
				lastTouch = lastJob.completed_at || lastJob.failed_at || lastJob.canceled_at || lastJob.last_heartbeat;
				if (typeof lastTouch === 'string') {
					lastTouch = new Date(lastTouch);
				}
			}
			let recentlyTouched = false;
			const now = new Date();
			const threshold = parseInt(env.SCALE_TO_ZERO_MINUTES);
			if (lastTouch && now.getTime() - lastTouch.getTime() < 1000 * 60 * threshold) {
				recentlyTouched = true;
			}

			const minReplicas = env.MIN_REPLICAS ? parseInt(env.MIN_REPLICAS) : 0;
			const maxReplicas = env.MAX_REPLICAS ? parseInt(env.MAX_REPLICAS) : 0;
			const isIdle = activeJobs.length === 0 && (!lastTouch || !recentlyTouched);
			if (minReplicas <= 0 && isIdle) {
				return scaleToZero(env);
			} else if (minReplicas > 0 && isIdle) {
				return scaleToReplicas(env, minReplicas);
			} else if (activeJobs.length > 0) {
				let replicas = Math.max(minReplicas, activeJobs.length);
				replicas = Math.min(maxReplicas, replicas);

				// We only need this check if we're not already at the max replicas
				if (replicas < maxReplicas) {
					const recentJobs = await getJobsTouchedWithin(env, threshold);
					replicas += recentJobs.length;
					replicas = Math.min(maxReplicas, replicas);
				}
				
				return scaleToReplicas(env, replicas);
			}
		} catch (e) {
			console.log(e);
		}
		await reallocateBadInstances(env);
	},
};

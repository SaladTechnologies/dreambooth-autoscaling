
export interface Env {
	DB: D1Database;
	SALAD_API_KEY: string;
	SALAD_ORG: string;
	SALAD_PROJECT: string;
	SALAD_CONTAINER_GROUP: string;
	SCALE_TO_ZERO_MINUTES: string;
	MIN_REPLICAS: string | undefined;
	MAX_REPLICAS: string | undefined;
}

type ContainerConfig = {
	image: string;
	resources: {
		cpu: number;
		memory: number;
		gpu_classes: string[];
		storage_amount: number;
	};
	command: string[];
	size: number;
	environment_variables: {
		API_URL: string;
		API_KEY: string;
		WANDB_API_KEY: string;
	};
};

type CurrentState = {
	status: 'pending' | 'running' | 'stopped' | 'succeeded' | 'failed' | 'deploying'; // Assuming status is a fixed set of strings, you can replace 'stopped' with a union of possible status strings if there are more (e.g., 'running' | 'stopped' | 'pending').
	description: string;
	start_time: string; // Using string to represent ISO date-time strings; consider using Date or a more specific date-time library type if desired.
	finish_time: string; // Similarly, using string to represent ISO date-time strings.
	instance_status_count: {
		allocating_count: number;
		creating_count: number;
		running_count: number;
	};
};

type ContainerGroup = {
	id: string;
	name: string;
	display_name: string;
	container: ContainerConfig;
	autostart_policy: boolean;
	restart_policy: 'always' | 'on_failure' | 'never';
	replicas: number;
	current_state: CurrentState;
	create_time: string; // Using string to represent ISO date-time strings; consider using Date or a more specific date-time library type if desired.
	update_time: string; // Similarly, using string to represent ISO date-time strings.
	version: number;
};

type ActiveJob = {
	status: string;
	created_at: string;
	completed_at: string;
	last_heartbeat: string;
};

async function getActiveJobs(env: Env): Promise<ActiveJob[]> {
	console.log('getting active jobs');
	const { results } = await env.DB.prepare(
		"SELECT status, created_at, completed_at, last_heartbeat FROM TrainingJobs WHERE status IN ('running', 'pending')"
	).all();
	console.log(results.length, 'active jobs');
	return results as ActiveJob[];
}

type LastTouchedJob = {
	status?: string;
	last_heartbeat?: string;
	completed_at?: string;
	failed_at?: string;
	canceled_at?: string;
};

const lastTouchedQuery = `
SELECT last_heartbeat, completed_at, failed_at, canceled_at
FROM TrainingJobs
WHERE status NOT IN ('running', 'pending')
ORDER BY COALESCE(completed_at, failed_at, canceled_at, last_heartbeat) DESC
LIMIT 1;
`

async function getLastTouchedJob(env: Env): Promise<LastTouchedJob | null> {
	console.log('getting last touched job');
	const { results } = await env.DB.prepare(lastTouchedQuery).all();
	console.log('last touched job', !!results.length);
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
`

async function getJobsTouchedWithin(env: Env, minutes: number): Promise<LastTouchedJob[]> {
	console.log('getting jobs touched within', minutes);
	const { results } = await env.DB.prepare(recentlyTouchedQuery).bind(minutes).all();
	console.log(results.length, 'jobs touched within', minutes, 'minutes');
	return results as LastTouchedJob[];
}

async function getContainerGroup(env: Env): Promise<ContainerGroup> {
	const baseURL = `https://api.salad.com/api/public/organizations/${env.SALAD_ORG}/projects/${env.SALAD_PROJECT}/containers/${env.SALAD_CONTAINER_GROUP}`;
	const response = await fetch(baseURL, {
		headers: {
			'Salad-Api-Key': env.SALAD_API_KEY,
		},
	});
	if (!response.ok) {
		throw new Error(`Failed to fetch from Salad API: ${response.status}: ${response.statusText}`);
	}
	const group = (await response.json()) as ContainerGroup;
	return group;
}

async function scaleToZero(env: Env) {
	const group = await getContainerGroup(env);
	const {
		current_state: { status },
	} = group;
	if (['stopped', 'failed'].includes(status)) {
		return; // Already stopped or failed, no need to do anything.
	}
	const url = `https://api.salad.com/api/public/organizations/${env.SALAD_ORG}/projects/${env.SALAD_PROJECT}/containers/${env.SALAD_CONTAINER_GROUP}/stop`;
	const stopResponse = await fetch(url, {
		method: 'POST',
		headers: {
			'Salad-Api-Key': env.SALAD_API_KEY,
		},
	});
	if (!stopResponse.ok) {
		throw new Error(`Failed to stop container group: ${stopResponse.status}: ${stopResponse.statusText}`);
	}
	return;
}

async function startContainerGroup(env: Env) {
	const url = `https://api.salad.com/api/public/organizations/${env.SALAD_ORG}/projects/${env.SALAD_PROJECT}/containers/${env.SALAD_CONTAINER_GROUP}/start`;
	const startResponse = await fetch(url, {
		method: 'POST',
		headers: {
			'Salad-Api-Key': env.SALAD_API_KEY,
		},
	});
	if (!startResponse.ok) {
		throw new Error(`Failed to start container group: ${startResponse.status}: ${startResponse.statusText}`);
	}
	return;
}

async function scaleToReplicas(env: Env, replicas: number) {
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
	console.log('scaling to', replicas);
	console.log('PATCH', url);
	const response = await fetch(url, {
		method: 'PATCH',
		headers: {
			'Salad-Api-Key': env.SALAD_API_KEY,
			'Content-Type': 'application/merge-patch+json',
			'Accept': 'application/json'
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
			
			if (minReplicas <= 0 && activeJobs.length === 0 && (!lastTouch || !recentlyTouched)) {
				return scaleToZero(env);
			} else if (activeJobs.length > 0){
				const recentJobs = await getJobsTouchedWithin(env, threshold);
				let replicas = Math.max(minReplicas, activeJobs.length + recentJobs.length);
				replicas = Math.min(maxReplicas, replicas);
				return scaleToReplicas(env, replicas);
			}
		} catch (e) {
			console.log(e);
		}
	},
};

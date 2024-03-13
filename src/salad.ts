import { Env, ContainerGroup, InstanceList } from './types';

export async function getContainerGroup(env: Env): Promise<ContainerGroup> {
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

export async function scaleToZero(env: Env) {
	const group = await getContainerGroup(env);
	const {
		current_state: { status },
	} = group;
	if (['stopped', 'failed'].includes(status)) {
		return; // Already stopped or failed, no need to do anything.
	}
	await stopContainerGroup(env);
}

export async function stopContainerGroup(env: Env) {
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

export async function startContainerGroup(env: Env) {
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

export async function reallocateInstance(env: Env, machineId: string) {
	const url = `https://api.salad.com/api/public/organizations/${env.SALAD_ORG}/projects/${env.SALAD_PROJECT}/containers/${env.SALAD_CONTAINER_GROUP}/instances/${machineId}/reallocate`;
	const response = await fetch(url, {
		method: 'POST',
		headers: {
			'Salad-Api-Key': env.SALAD_API_KEY,
		},
	});
	if (!response.ok && response.status !== 404) {
		throw new Error(`Failed to reallocate instance: ${response.status}: ${response.statusText}`);
	}
    console.log('reallocated instance', machineId);
}

export async function listContainerGroupInstances(env: Env): Promise<InstanceList> {
	const url = `https://api.salad.com/api/public/organizations/${env.SALAD_ORG}/projects/${env.SALAD_PROJECT}/containers/${env.SALAD_CONTAINER_GROUP}/instances`;
	const response = await fetch(url, {
		headers: {
			'Salad-Api-Key': env.SALAD_API_KEY,
		},
	});
	if (!response.ok) {
		throw new Error(`Failed to list container group instances: ${response.status}: ${response.statusText}`);
	}
	const instanceList = (await response.json()) as InstanceList;
	return instanceList;
}

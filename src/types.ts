export interface Env {
	DB: D1Database;
	SALAD_API_KEY: string;
	SALAD_ORG: string;
	SALAD_PROJECT: string;
	SALAD_CONTAINER_GROUP: string;
	SCALE_TO_ZERO_MINUTES: string;
	MIN_REPLICAS: string;
	MAX_REPLICAS: string;
	MAX_FAILURES_PER_WORKER: string;
	BANNED_WORKERS: KVNamespace;
}

export type ContainerConfig = {
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

export type CurrentState = {
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

export type ContainerGroup = {
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

export type ActiveJob = {
	status: string;
	created_at: string;
	completed_at: string;
	last_heartbeat: string;
};

export type LastTouchedJob = {
	status?: string;
	last_heartbeat?: string;
	completed_at?: string;
	failed_at?: string;
	canceled_at?: string;
};

export type Instance = {
    machine_id: string;
    state: 'allocating' | 'creating' | 'running' | 'downloading',
    update_time: string,
    version: number,
}

export type InstanceList = {
    instances: Instance[],
}
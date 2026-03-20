export interface Toast {
	id: number;
	message: string;
	type: 'success' | 'error' | 'info';
	duration: number;
}

let nextId = 0;
let toasts: Toast[] = $state([]);

export function getToasts(): Toast[] {
	return toasts;
}

export function addToast(message: string, type: Toast['type'] = 'info', duration = 3000) {
	const id = nextId++;
	toasts.push({ id, message, type, duration });
	if (duration > 0) {
		setTimeout(() => removeToast(id), duration);
	}
}

export function removeToast(id: number) {
	toasts = toasts.filter((t) => t.id !== id);
}

export const toast = {
	success: (msg: string) => addToast(msg, 'success'),
	error: (msg: string) => addToast(msg, 'error', 5000),
	info: (msg: string) => addToast(msg, 'info'),
};

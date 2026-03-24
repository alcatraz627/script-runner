/**
 * App-wide constants. buildTag is updated after each UI change to verify
 * the browser is serving the latest build (shown in sidebar footer).
 */
export const APP = {
	title: 'Script Runner',
	subtitle: 'Versable | Jegs | Ebay',
	port: 3460,
	pollInterval: 5000,
	pageSize: 50,
	maxPreviewRows: 30,
	buildTag: 'frost-pine-21',
} as const;

export interface NavItem {
	label: string;
	href: string;
	icon: string;
	desc: string;
	external?: boolean;
}

export const NAV_ITEMS: NavItem[] = [
	{ label: 'Runs', href: '/runs', icon: 'play', desc: 'Pipeline executions' },
	{ label: 'Compare', href: '/runs/compare', icon: 'compare', desc: 'Side-by-side diffs' },
	{ label: 'Files', href: '/files', icon: 'file', desc: 'Manage input files' },
	{ label: 'Transforms', href: '/transforms', icon: 'code', desc: 'Data functions' },
	{ label: 'Docs', href: '/docs', icon: 'docs', desc: 'Project documentation' },
	{ label: 'API Docs', href: `http://localhost:${APP.port}/api/docs`, icon: 'api', desc: 'Scalar API browser', external: true },
];

<script lang="ts">
	import { onMount } from 'svelte';
	import { api } from '$lib/api';
	import type { TransformInfo, FileInfo } from '$lib/types';

	interface Props {
		runId: string;
		onConfigSaved?: () => void;
	}

	let { runId, onConfigSaved }: Props = $props();

	let config: Record<string, any> = $state({});
	let transforms: TransformInfo[] = $state([]);
	let loading = $state(true);
	let saving = $state(false);
	let error: string | null = $state(null);
	let success: string | null = $state(null);

	// File upload state
	let uploading = $state(false);
	let sheets: string[] = $state([]);
	let fileInputEl: HTMLInputElement | undefined = $state(undefined);

	// Browse existing files state
	let showBrowse = $state(false);
	let allFiles: FileInfo[] = $state([]);
	let filesLoading = $state(false);
	let linking = $state(false);

	async function openBrowse() {
		showBrowse = true;
		filesLoading = true;
		try {
			allFiles = await api.files.list();
			allFiles = allFiles.filter(f => f.runId !== runId);
		} catch { /* ignore */ }
		finally { filesLoading = false; }
	}

	async function linkFile(file: FileInfo) {
		linking = true;
		error = null;
		try {
			const result = await api.files.linkToRun(runId, file.runId, file.filename);
			config.input = { ...config.input, file: result.path };
			sheets = result.sheets;
			if (sheets.length === 1) {
				config.input.sheet = sheets[0];
			}
			showBrowse = false;
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to link file';
		} finally {
			linking = false;
		}
	}

	// Per-step expand state
	let expandedStep: number | null = $state(null);

	// Per-step config edit buffers
	let configBuffers: Map<number, string> = $state(new Map());
	let columnMapBuffers: Map<number, string> = $state(new Map());

	function toggleStep(index: number) {
		if (expandedStep === index) {
			expandedStep = null;
		} else {
			expandedStep = index;
			const step = config.steps[index];
			if (step.config && Object.keys(step.config).length > 0) {
				configBuffers.set(index, JSON.stringify(step.config, null, 2));
			} else {
				configBuffers.set(index, '');
			}
			if (step.columnMap && Object.keys(step.columnMap).length > 0) {
				columnMapBuffers.set(index, JSON.stringify(step.columnMap, null, 2));
			} else {
				columnMapBuffers.set(index, '');
			}
		}
	}

	function getTransformInfo(fnName: string): TransformInfo | undefined {
		return transforms.find(t => t.name === fnName);
	}

	function syncConfigBuffer(index: number, value: string) {
		configBuffers.set(index, value);
		if (!value.trim()) {
			config.steps[index].config = {};
			return;
		}
		try {
			config.steps[index].config = JSON.parse(value);
		} catch { /* still typing */ }
	}

	function syncColumnMapBuffer(index: number, value: string) {
		columnMapBuffers.set(index, value);
		if (!value.trim()) {
			delete config.steps[index].columnMap;
			return;
		}
		try {
			config.steps[index].columnMap = JSON.parse(value);
		} catch { /* still typing */ }
	}

	async function loadDefaults(index: number) {
		const step = config.steps[index];
		try {
			const result = await api.transforms.defaults(step.fn);
			if (result.defaults && Object.keys(result.defaults).length > 0) {
				step.config = result.defaults;
				configBuffers.set(index, JSON.stringify(step.config, null, 2));
			} else if (result.config) {
				try {
					step.config = JSON.parse(result.config);
					configBuffers.set(index, JSON.stringify(step.config, null, 2));
				} catch {
					configBuffers.set(index, result.config);
				}
			}
		} catch {
			const tfInfo = getTransformInfo(step.fn);
			if (tfInfo?.config) {
				try {
					step.config = JSON.parse(tfInfo.config);
					configBuffers.set(index, JSON.stringify(step.config, null, 2));
				} catch {}
			}
		}
	}

	async function onTransformChange(index: number, fnName: string) {
		config.steps[index].fn = fnName;
		const step = config.steps[index];
		if (!step.config || Object.keys(step.config).length === 0) {
			await loadDefaults(index);
		}
	}

	onMount(async () => {
		try {
			const [cfg, tfList] = await Promise.all([
				api.runs.config(runId),
				api.transforms.list(),
			]);
			config = cfg;
			transforms = tfList;

			if (config.input?.file) {
				try {
					const result = await api.files.sheets(`${runId}/${config.input.file}`);
					sheets = result.sheets;
				} catch { /* file might not exist yet */ }
			}
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to load config';
		} finally {
			loading = false;
		}
	});

	async function handleFileUpload(e: Event) {
		const input = e.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;

		uploading = true;
		error = null;
		try {
			const result = await api.runs.upload(runId, file);
			config.input = { ...config.input, file: result.path };
			sheets = result.sheets;
			if (sheets.length === 1) {
				config.input.sheet = sheets[0];
			}
		} catch (e) {
			error = e instanceof Error ? e.message : 'Upload failed';
		} finally {
			uploading = false;
		}
	}

	function addStep() {
		if (!config.steps) config.steps = [];
		const idx = config.steps.length + 1;
		config.steps = [...config.steps, {
			id: `step-${idx}`,
			fn: transforms[0]?.name ?? '',
			config: {},
		}];
	}

	function removeStep(index: number) {
		config.steps = config.steps.filter((_: unknown, i: number) => i !== index);
		if (expandedStep === index) expandedStep = null;
		else if (expandedStep !== null && expandedStep > index) expandedStep--;
	}

	function moveStep(index: number, dir: -1 | 1) {
		const newIndex = index + dir;
		if (newIndex < 0 || newIndex >= config.steps.length) return;
		const steps = [...config.steps];
		[steps[index], steps[newIndex]] = [steps[newIndex], steps[index]];
		config.steps = steps;
		if (expandedStep === index) expandedStep = newIndex;
		else if (expandedStep === newIndex) expandedStep = index;
	}

	async function saveConfig() {
		saving = true;
		error = null;
		success = null;
		try {
			await api.runs.updateConfig(runId, {
				input: config.input,
				steps: config.steps,
				name: config.name,
				description: config.description,
				output: config.output,
			});
			success = 'Config saved';
			setTimeout(() => { success = null; }, 2000);
			onConfigSaved?.();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to save config';
		} finally {
			saving = false;
		}
	}
</script>

{#if loading}
	<div class="text-sm text-[var(--color-text-muted)] py-4">Loading config...</div>
{:else}
	<div class="space-y-5">
		{#if error}
			<div class="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 text-red-700 dark:text-red-400 text-sm">{error}</div>
		{/if}
		{#if success}
			<div class="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-lg p-3 text-emerald-700 dark:text-emerald-400 text-sm animate-fade-in">{success}</div>
		{/if}

		<!-- Input file section -->
		<div class="space-y-2">
			<h4 class="text-xs font-medium text-[var(--color-text-secondary)] uppercase tracking-wider">Input File</h4>
			<div class="flex items-center gap-2 flex-wrap">
				<button
					onclick={() => fileInputEl?.click()}
					disabled={uploading}
					class="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-[var(--color-border)] rounded-lg hover:bg-[var(--color-bg-surface-hover)] transition-colors disabled:opacity-50"
				>
					<svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" /></svg>
					{uploading ? 'Uploading...' : 'Upload'}
				</button>
				<button
					onclick={openBrowse}
					class="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-[var(--color-border)] rounded-lg hover:bg-[var(--color-bg-surface-hover)] transition-colors"
				>
					<svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244" /></svg>
					Link Existing
				</button>
				<input
					bind:this={fileInputEl}
					type="file"
					accept=".xlsx,.xls,.csv,.json"
					onchange={handleFileUpload}
					class="hidden"
				/>
				{#if config.input?.file}
					<span class="text-xs font-mono text-[var(--color-text-primary)] bg-[var(--color-bg-inset)] px-2 py-1 rounded border border-[var(--color-border)]">{config.input.file}</span>
				{:else}
					<span class="text-xs text-[var(--color-text-muted)] italic">No file selected</span>
				{/if}
			</div>

			{#if showBrowse}
				<div class="border border-[var(--color-border)] rounded-lg bg-[var(--color-bg-surface)] overflow-hidden animate-fade-in">
					<div class="flex items-center justify-between px-3 py-2 bg-[var(--color-bg-inset)] border-b border-[var(--color-border)]">
						<span class="text-xs font-medium text-[var(--color-text-secondary)]">Files from other runs</span>
						<button onclick={() => { showBrowse = false; }} class="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]">&times;</button>
					</div>
					{#if filesLoading}
						<div class="text-xs text-[var(--color-text-muted)] p-3">Loading files...</div>
					{:else if allFiles.length === 0}
						<div class="text-xs text-[var(--color-text-muted)] p-3">No files found in other runs.</div>
					{:else}
						<div class="divide-y divide-[var(--color-border-light)] max-h-48 overflow-y-auto">
							{#each allFiles as f (f.runId + '/' + f.filename)}
								<button
									onclick={() => linkFile(f)}
									disabled={linking}
									class="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-[var(--color-bg-surface-hover)] transition-colors disabled:opacity-50"
								>
									<span class="text-xs font-medium text-[var(--color-text-primary)] flex-1 truncate">{f.filename}</span>
									<span class="text-[10px] text-[var(--color-text-muted)] font-mono shrink-0">{f.runId}</span>
								</button>
							{/each}
						</div>
					{/if}
				</div>
			{/if}

			{#if sheets.length > 0}
				<div class="flex items-center gap-2">
					<label for="sheet" class="text-xs text-[var(--color-text-secondary)]">Sheet:</label>
					<select
						id="sheet"
						bind:value={config.input.sheet}
						class="px-2 py-1 text-xs border border-[var(--color-border)] rounded-lg bg-[var(--color-bg-surface)]"
					>
						<option value="">-- select --</option>
						{#each sheets as sheet (sheet)}
							<option value={sheet}>{sheet}</option>
						{/each}
					</select>
				</div>
			{/if}
		</div>

		<!-- Pipeline steps -->
		<div class="space-y-2">
			<div class="flex items-center justify-between">
				<h4 class="text-xs font-medium text-[var(--color-text-secondary)] uppercase tracking-wider">Pipeline Steps</h4>
				<button
					onclick={addStep}
					class="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-[var(--color-brand)] border border-[var(--color-brand)] rounded-lg hover:bg-[var(--color-brand-light)] transition-colors active:scale-[0.98]"
				>
					<svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
					Add Step
				</button>
			</div>

			{#if !config.steps || config.steps.length === 0}
				<div class="text-sm text-[var(--color-text-muted)] py-6 text-center border-2 border-dashed border-[var(--color-border)] rounded-lg">
					No steps yet. Add a step to build the pipeline.
				</div>
			{:else}
				<div class="space-y-2">
					{#each config.steps as step, i (i)}
						{@const tfInfo = getTransformInfo(step.fn)}
						<div class="rounded-lg border overflow-hidden transition-all {expandedStep === i ? 'border-[var(--color-brand)] shadow-sm' : 'border-[var(--color-border)]'}">
							<!-- Step header -->
							<div
								class="flex items-center gap-2 px-3 py-2.5 bg-[var(--color-bg-surface)] {expandedStep === i ? 'border-b border-[var(--color-border)]' : ''}"
							>
								<!-- Reorder arrows -->
								<div class="flex flex-col shrink-0">
									<button
										onclick={() => moveStep(i, -1)}
										disabled={i === 0}
										class="text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] disabled:opacity-20 text-[10px] leading-none px-0.5"
									>&#9650;</button>
									<button
										onclick={() => moveStep(i, 1)}
										disabled={i === config.steps.length - 1}
										class="text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] disabled:opacity-20 text-[10px] leading-none px-0.5"
									>&#9660;</button>
								</div>

								<!-- Step number badge -->
								<span class="w-5 h-5 rounded bg-[var(--color-bg-inset)] text-[10px] font-bold text-[var(--color-text-muted)] flex items-center justify-center shrink-0">{i + 1}</span>

								<!-- Step ID input -->
								<input
									type="text"
									bind:value={step.id}
									placeholder="step-id"
									class="px-2 py-1 text-xs font-mono border border-[var(--color-border)] rounded bg-[var(--color-bg-surface)] w-28 focus:outline-none focus:ring-1 focus:ring-[var(--color-brand)] focus:border-[var(--color-brand)]"
								/>

								<!-- Transform select -->
								<div class="flex-1 min-w-0">
									<select
										value={step.fn}
										onchange={(e) => onTransformChange(i, (e.target as HTMLSelectElement).value)}
										class="w-full px-2 py-1 text-xs border border-[var(--color-border)] rounded bg-[var(--color-bg-surface)] focus:outline-none focus:ring-1 focus:ring-[var(--color-brand)]"
									>
										{#each transforms as t (t.name)}
											<option value={t.name}>{t.name}</option>
										{/each}
									</select>
								</div>

								<!-- Badges -->
								<div class="flex items-center gap-1.5 shrink-0">
									{#if tfInfo?.hasSystemPrompt}
										<span class="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium bg-purple-50 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400 border border-purple-200 dark:border-purple-800">
											<svg class="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" /></svg>
											LLM
										</span>
									{/if}
									{#if step.config && Object.keys(step.config).length > 0}
										<span class="w-1.5 h-1.5 rounded-full bg-blue-400 shrink-0" title="Has config"></span>
									{/if}
								</div>

								<!-- Expand toggle -->
								<button
									onclick={() => toggleStep(i)}
									class="p-1 rounded transition-colors {expandedStep === i ? 'text-[var(--color-brand)] bg-[var(--color-brand-light)]' : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-inset)]'}"
									title="Configure step"
								>
									<svg class="w-4 h-4 transition-transform {expandedStep === i ? 'rotate-180' : ''}" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" /></svg>
								</button>

								<!-- Remove -->
								<button
									onclick={() => removeStep(i)}
									class="p-1 rounded text-[var(--color-text-muted)] hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
									title="Remove step"
								>
									<svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
								</button>
							</div>

							<!-- Transform description (always visible if not expanded) -->
							{#if tfInfo?.description && expandedStep !== i}
								<div class="px-3 py-1.5 bg-[var(--color-bg-surface-hover)] text-[10px] text-[var(--color-text-muted)] truncate">{tfInfo.description.split('\n')[0]}</div>
							{/if}

							<!-- Expanded config panel -->
							{#if expandedStep === i}
								<div class="bg-[var(--color-bg-surface-hover)] px-4 py-3 space-y-3 animate-fade-in">
									{#if tfInfo?.description}
										<p class="text-xs text-[var(--color-text-secondary)] leading-relaxed">{tfInfo.description.split('\n')[0]}</p>
									{/if}

									<!-- Transform Config -->
									<div>
										<div class="flex items-center justify-between mb-1.5">
											<label for="step-config-{i}" class="text-xs font-medium text-[var(--color-text-secondary)]">Config (JSON)</label>
											{#if tfInfo?.config}
												<button
													onclick={() => loadDefaults(i)}
													class="text-[10px] font-medium text-[var(--color-brand)] hover:text-[var(--color-brand-hover)] transition-colors"
												>Load defaults</button>
											{/if}
										</div>
										<textarea id="step-config-{i}"
											value={configBuffers.get(i) ?? ''}
											oninput={(e) => syncConfigBuffer(i, (e.target as HTMLTextAreaElement).value)}
											placeholder={tfInfo?.config || '{ }'}
											class="w-full px-3 py-2 text-xs font-mono border border-[var(--color-border)] rounded-lg bg-[var(--color-bg-surface)] focus:outline-none focus:ring-1 focus:ring-[var(--color-brand)] resize-y"
											rows="3"
											spellcheck="false"
										></textarea>
									</div>

									<!-- Column Map -->
									<div>
										<label for="step-colmap-{i}" class="text-xs font-medium text-[var(--color-text-secondary)] mb-1.5 block">
											Column Map <span class="font-normal text-[var(--color-text-muted)]">(rename before transform)</span>
										</label>
										<textarea id="step-colmap-{i}"
											value={columnMapBuffers.get(i) ?? ''}
											oninput={(e) => syncColumnMapBuffer(i, (e.target as HTMLTextAreaElement).value)}
											placeholder='&#123; "oldName": "newName" &#125;'
											class="w-full px-3 py-2 text-xs font-mono border border-[var(--color-border)] rounded-lg bg-[var(--color-bg-surface)] focus:outline-none focus:ring-1 focus:ring-[var(--color-brand)] resize-y"
											rows="2"
											spellcheck="false"
										></textarea>
									</div>

									<!-- Output filename -->
									<div>
										<label for="step-outfile-{i}" class="text-xs font-medium text-[var(--color-text-secondary)] mb-1.5 block">
											Output Filename <span class="font-normal text-[var(--color-text-muted)]">(optional)</span>
										</label>
										<input
											type="text"
											bind:value={step.outputFilename}
											placeholder="auto-generated from step ID"
											class="w-full px-3 py-2 text-xs font-mono border border-[var(--color-border)] rounded-lg bg-[var(--color-bg-surface)] focus:outline-none focus:ring-1 focus:ring-[var(--color-brand)]"
										/>
									</div>

									<!-- I/O hint -->
									{#if tfInfo?.inputOutput}
										<div class="text-[10px] text-[var(--color-text-muted)] border-t border-[var(--color-border-light)] pt-2 flex gap-4">
											{#each tfInfo.inputOutput.split('\n') as line}
												<span>{line}</span>
											{/each}
										</div>
									{/if}
								</div>
							{/if}
						</div>
					{/each}
				</div>
			{/if}
		</div>

		<!-- Save button -->
		<div class="flex items-center gap-3 pt-3 border-t border-[var(--color-border-light)]">
			<button
				onclick={saveConfig}
				disabled={saving}
				class="inline-flex items-center gap-2 px-4 py-2 bg-[var(--color-brand)] text-white text-sm font-medium rounded-lg hover:bg-[var(--color-brand-hover)] disabled:opacity-50 transition-all active:scale-[0.98]"
			>
				{#if saving}
					<svg class="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
					Saving...
				{:else}
					Save Config
				{/if}
			</button>
		</div>
	</div>
{/if}

// The flow-diagram layout engine (elkjs), loaded the first time a flow diagram is laid out, so that a page without one never
// fetches or evaluates it. A host that wants the layout somewhere else (a Web Worker in a browser) installs its own with
// `setLayoutEngine`. The engine is one per module, shared by every render in the page or process (internal spec, lede-lang/meta).
export type LayoutFn = (graph: unknown) => Promise<unknown>;

let engine: LayoutFn | null = null;

/** Lay out with `fn` from now on. `fn` takes an ELK graph and resolves to the laid-out graph, as `elk.layout` does. */
export function setLayoutEngine(fn: LayoutFn): void {
  engine = fn;
}

export async function layout(graph: unknown): Promise<unknown> {
  let run = engine;
  if (!run) {
    // elkjs ships a bundled build with no worker; it runs the same in Node and the browser. It is CommonJS, so under
    // NodeNext its typings miss the default-export constructor.
    const { default: ELK } = await import('elkjs/lib/elk.bundled.js');
    const elk = new (ELK as unknown as new () => { layout: LayoutFn })();
    // Two layouts may race to load it: the first to resolve keeps its engine.
    run = engine ??= (g) => elk.layout(g);
  }
  return run(graph);
}

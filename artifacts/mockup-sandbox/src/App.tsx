import { useEffect, useState, type ComponentType } from "react";

import { modules as discoveredModules } from "./.generated/mockup-components";

type ModuleMap = Record<string, () => Promise<Record<string, unknown>>>;

function _resolveComponent(
  mod: Record<string, unknown>,
  name: string,
): ComponentType | undefined {
  const fns = Object.values(mod).filter(
    (v) => typeof v === "function",
  ) as ComponentType[];
  return (
    (mod.default as ComponentType) ||
    (mod.Preview as ComponentType) ||
    (mod[name] as ComponentType) ||
    fns[fns.length - 1]
  );
}

function PreviewRenderer({
  componentPath,
  modules,
}: {
  componentPath: string;
  modules: ModuleMap;
}) {
  const [Component, setComponent] = useState<ComponentType | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    setComponent(null);
    setError(null);

    async function loadComponent(): Promise<void> {
      const key = `./components/mockups/${componentPath}.tsx`;
      const loader = modules[key];
      if (!loader) {
        setError(`No component found at ${componentPath}.tsx`);
        return;
      }

      try {
        const mod = await loader();
        if (cancelled) {
          return;
        }
        const name = componentPath.split("/").pop()!;
        const comp = _resolveComponent(mod, name);
        if (!comp) {
          setError(
            `No exported React component found in ${componentPath}.tsx\n\nMake sure the file has at least one exported function component.`,
          );
          return;
        }
        setComponent(() => comp);
      } catch (e) {
        if (cancelled) {
          return;
        }

        const message = e instanceof Error ? e.message : String(e);
        setError(`Failed to load preview.\n${message}`);
      }
    }

    void loadComponent();

    return () => {
      cancelled = true;
    };
  }, [componentPath, modules]);

  if (error) {
    return (
      <pre style={{ color: "red", padding: "2rem", fontFamily: "system-ui" }}>
        {error}
      </pre>
    );
  }

  if (!Component) return null;

  return <Component />;
}

function getBasePath(): string {
  return import.meta.env.BASE_URL.replace(/\/$/, "");
}

function getPreviewExamplePath(): string {
  const basePath = getBasePath();
  return `${basePath}/preview/ComponentName`;
}

function Gallery() {
  const basePath = getBasePath();
  return <div className="min-h-screen bg-[#f5f1eb] p-8 text-[#17233a]">
    <div className="mx-auto max-w-3xl pt-12">
      <div className="mb-10 flex items-center gap-4">
        <img src={`${basePath}/images/redeemer-house-logo.jpeg`} alt="Redeemer House" className="h-16 w-16 rounded-2xl bg-white object-contain shadow-sm" />
        <div><div className="text-xs font-bold uppercase tracking-[.18em] text-[#a2185b]">Canvas previews</div><h1 className="mt-1 font-['Fraunces'] text-4xl font-semibold tracking-tight">Redeemer House Operations</h1></div>
      </div>
      <p className="max-w-xl text-sm leading-7 text-[#647087]">Review-ready dashboard directions for the owner, program director, and assigned house manager perspective.</p>
      <a href={`${basePath}/preview/redeemer-branded/Dashboard`} className="mt-8 flex items-center justify-between rounded-2xl border border-[#e6e0d9] bg-[#fffdfb] p-5 shadow-[0_10px_30px_rgba(20,43,85,.045)] transition hover:border-[#a2185b]">
        <span><strong className="block text-sm">Redeemer dashboard · responsive</strong><small className="mt-1 block text-xs text-[#647087]">Scope controls, occupancy, attention states, activity, payments, and quick actions</small></span><span className="text-xl text-[#a2185b]">→</span>
      </a>
      <p className="mt-6 text-xs text-[#647087]">Additional page previews remain available at <code className="rounded bg-white px-1.5 py-1 text-[#a2185b]">{getPreviewExamplePath()}</code></p>
    </div>
  </div>;
}

function getPreviewPath(): string | null {
  const basePath = getBasePath();
  const { pathname } = window.location;
  const local =
    basePath && pathname.startsWith(basePath)
      ? pathname.slice(basePath.length) || "/"
      : pathname;
  const match = local.match(/^\/preview\/(.+)$/);
  return match ? match[1] : null;
}

function App() {
  const previewPath = getPreviewPath();

  if (previewPath) {
    return (
      <PreviewRenderer
        componentPath={previewPath}
        modules={discoveredModules}
      />
    );
  }

  return <Gallery />;
}

export default App;

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  ArrowUpRight,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleHelp,
  Clock3,
  Copy,
  Database,
  Eye,
  EyeOff,
  FileJson,
  KeyRound,
  Menu,
  Play,
  Plus,
  RefreshCw,
  Server,
  ShieldCheck,
  Trash2,
  Upload,
  X,
  Zap,
} from "lucide-react";
import { toast } from "sonner";

type ProjectStatus = "idle" | "checking" | "online" | "error";

type SupabaseProject = {
  id: string;
  name: string;
  url: string;
  key: string;
  status: ProjectStatus;
  lastChecked?: string;
  latency?: number;
  error?: string;
};

const STORAGE_KEY = "supabase-keepalive-projects";
const LAST_RUN_KEY = "supabase-keepalive-last-run";
const TIMER_KEY = "supabase-keepalive-timer";
const NEXT_RUN_KEY = "supabase-keepalive-next-run";
const TIMER_OPTIONS = [5, 10, 15, 30, 60, 180, 360, 720, 1440];

const seedProjects: SupabaseProject[] = [
  {
    id: "example-analytics",
    name: "Analytics workspace",
    url: "https://your-project.supabase.co",
    key: "",
    status: "idle",
  },
];

function cleanUrl(value: string) {
  return value.trim().replace(/\/$/, "");
}

function formatTime(value?: string) {
  if (!value) return "Never checked";
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
    day: "numeric",
  }).format(new Date(value));
}

function maskKey(value: string) {
  if (!value) return "No anon key added";
  return `${value.slice(0, 7)}••••••••${value.slice(-5)}`;
}

function formatCountdown(milliseconds: number) {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? `${String(hours).padStart(2, "0")}h ${String(minutes).padStart(2, "0")}m`
    : `${String(minutes).padStart(2, "0")}m ${String(seconds).padStart(2, "0")}s`;
}

async function pingSupabase(project: SupabaseProject): Promise<Pick<SupabaseProject, "status" | "latency" | "lastChecked" | "error">> {
  const started = performance.now();
  const checkedAt = new Date().toISOString();

  if (!project.url || !project.key) {
    return { status: "error", lastChecked: checkedAt, error: "Add a project URL and anon key first." };
  }

  try {
    // Supabase documents /auth/v1/health as the lightweight project health
    // probe. Send the key only as `apikey`: newer publishable keys are not
    // JWTs and can fail when incorrectly repeated as a Bearer token.
    const response = await fetch(`${cleanUrl(project.url)}/auth/v1/health`, {
      method: "GET",
      headers: {
        apikey: project.key,
      },
      cache: "no-store",
    });
    const latency = Math.round(performance.now() - started);

    if (!response.ok) {
      return {
        status: "error",
        latency,
        lastChecked: checkedAt,
        error:
          response.status === 401
            ? "Supabase rejected this key. Use the project’s anon/public or publishable key—not a secret/service-role key—and confirm it belongs to this project."
            : `Supabase returned HTTP ${response.status}. Confirm the project URL and key.`,
      };
    }

    return { status: "online", latency, lastChecked: checkedAt };
  } catch {
    return {
      status: "error",
      latency: Math.round(performance.now() - started),
      lastChecked: checkedAt,
      error: "Request blocked or unreachable. Confirm the project URL and browser network access.",
    };
  }
}

function StatusPill({ status }: { status: ProjectStatus }) {
  if (status === "checking") {
    return (
      <span className="status-pill status-checking">
        <RefreshCw className="h-3.5 w-3.5 animate-spin" /> Checking
      </span>
    );
  }
  if (status === "online") {
    return (
      <span className="status-pill status-online">
        <span className="status-dot" /> Online
      </span>
    );
  }
  if (status === "error") {
    return (
      <span className="status-pill status-error">
        <span className="status-dot status-dot-error" /> Needs attention
      </span>
    );
  }
  return (
    <span className="status-pill status-idle">
      <span className="status-dot status-dot-idle" /> Not checked
    </span>
  );
}

export default function Home() {
  const [projects, setProjects] = useState<SupabaseProject[]>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      const parsed = stored ? JSON.parse(stored) : seedProjects;
      return parsed.map((project: SupabaseProject) => ({ ...project, status: "idle" }));
    } catch {
      return seedProjects;
    }
  });
  const [lastRun, setLastRun] = useState<string | undefined>(() => localStorage.getItem(LAST_RUN_KEY) || undefined);
  const [timerEnabled, setTimerEnabled] = useState<boolean>(() => localStorage.getItem(TIMER_KEY) !== "off");
  const [intervalMinutes, setIntervalMinutes] = useState<number>(() => {
    const stored = Number(localStorage.getItem(TIMER_KEY));
    return TIMER_OPTIONS.includes(stored) ? stored : 30;
  });
  const [isAdding, setIsAdding] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [isRunningAll, setIsRunningAll] = useState(false);
  const [visibleKey, setVisibleKey] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", url: "", key: "" });
  const [nextRunAt, setNextRunAt] = useState<number>(() => {
    const stored = Number(localStorage.getItem(NEXT_RUN_KEY));
    const savedInterval = TIMER_OPTIONS.includes(Number(localStorage.getItem(TIMER_KEY))) ? Number(localStorage.getItem(TIMER_KEY)) : 30;
    return stored > Date.now() ? stored : Date.now() + savedInterval * 60 * 1000;
  });
  const [countdown, setCountdown] = useState(() => formatCountdown(nextRunAt - Date.now()));
  const importInputRef = useRef<HTMLInputElement>(null);
  const timerSettingsInitialized = useRef(false);
  const projectKeySignature = projects.map((project) => `${project.id}:${project.key}`).join("|");

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
  }, [projects]);

  useEffect(() => {
    localStorage.setItem(TIMER_KEY, timerEnabled ? String(intervalMinutes) : "off");
  }, [intervalMinutes, timerEnabled]);

  useEffect(() => {
    if (!timerSettingsInitialized.current) {
      timerSettingsInitialized.current = true;
      return;
    }
    const next = timerEnabled ? Date.now() + intervalMinutes * 60 * 1000 : Date.now();
    setNextRunAt(next);
    localStorage.setItem(NEXT_RUN_KEY, String(next));
  }, [intervalMinutes, timerEnabled]);

  useEffect(() => {
    const tick = window.setInterval(() => setCountdown(formatCountdown(nextRunAt - Date.now())), 1000);
    return () => window.clearInterval(tick);
  }, [nextRunAt]);

  useEffect(() => {
    if (!timerEnabled || !projects.some((project) => project.key)) return;
    const scheduleNext = () => {
      const delay = Math.max(0, nextRunAt - Date.now());
      return window.setTimeout(() => void runChecks(false), delay);
    };
    let timeout = scheduleNext();
    const catchUpWhenVisible = () => {
      if (document.visibilityState === "visible" && Date.now() >= nextRunAt) {
        window.clearTimeout(timeout);
        void runChecks(false);
      }
    };
    document.addEventListener("visibilitychange", catchUpWhenVisible);
    return () => {
      window.clearTimeout(timeout);
      document.removeEventListener("visibilitychange", catchUpWhenVisible);
    };
    // The scheduler intentionally runs only while this page is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectKeySignature, projects.length, intervalMinutes, timerEnabled, nextRunAt]);

  const stats = useMemo(() => {
    const online = projects.filter((project) => project.status === "online").length;
    const attention = projects.filter((project) => project.status === "error").length;
    return { total: projects.length, online, attention };
  }, [projects]);

  async function runChecks(showToast = true) {
    if (!projects.length) return;
    setIsRunningAll(true);
    setProjects((current) => current.map((project) => (project.key ? { ...project, status: "checking", error: undefined } : project)));

    const results = await Promise.all(
      projects.map(async (project) => {
        if (!project.key) return project;
        return { ...project, ...(await pingSupabase(project)) };
      }),
    );

    const now = new Date().toISOString();
    setProjects(results);
    setLastRun(now);
    localStorage.setItem(LAST_RUN_KEY, now);
    const next = Date.now() + intervalMinutes * 60 * 1000;
    setNextRunAt(next);
    localStorage.setItem(NEXT_RUN_KEY, String(next));
    setIsRunningAll(false);

    if (showToast) {
      const onlineCount = results.filter((project) => project.status === "online").length;
      toast.success(`${onlineCount} of ${results.filter((project) => project.key).length} configured projects responded`, {
        description: "Only a read-only health request was sent.",
      });
    }
  }

  async function runSingle(project: SupabaseProject) {
    if (!project.key) {
      toast.error("Add an anon key before testing this project.");
      setIsAdding(true);
      return;
    }
    setProjects((current) => current.map((item) => (item.id === project.id ? { ...item, status: "checking", error: undefined } : item)));
    const result = await pingSupabase(project);
    setProjects((current) => current.map((item) => (item.id === project.id ? { ...item, ...result } : item)));
    toast[result.status === "online" ? "success" : "error"](result.status === "online" ? `${project.name} is online` : `${project.name} needs attention`, {
      description: result.status === "online" ? `${result.latency}ms response from the Supabase REST endpoint.` : result.error,
    });
  }

  function addProject(event: React.FormEvent) {
    event.preventDefault();
    const url = cleanUrl(form.url);
    if (!form.name.trim() || !url || !form.key.trim()) {
      toast.error("Complete all three fields to add a project.");
      return;
    }
    try {
      new URL(url);
    } catch {
      toast.error("Use a valid Supabase URL, for example https://project.supabase.co");
      return;
    }
    const newProject: SupabaseProject = {
      id: crypto.randomUUID(),
      name: form.name.trim(),
      url,
      key: form.key.trim(),
      status: "idle",
    };
    setProjects((current) => [...current, newProject]);
    setForm({ name: "", url: "", key: "" });
    setIsAdding(false);
    toast.success(`${newProject.name} added locally`);
  }

  function deleteProject(id: string) {
    const project = projects.find((item) => item.id === id);
    setProjects((current) => current.filter((item) => item.id !== id));
    toast.success(`${project?.name || "Project"} removed from this browser`);
  }

  function copyUrl(url: string) {
    void navigator.clipboard.writeText(url);
    toast.success("Project URL copied");
  }

  function exportProjects() {
    const backup = {
      version: 1,
      exportedAt: new Date().toISOString(),
      timerEnabled,
      intervalMinutes,
      projects: projects.map(({ id, name, url, key }) => ({ id, name, url, key })),
    };
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `supabase-keepalive-backup-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
    toast.success("Backup downloaded", { description: "This file contains your project keys. Store it securely." });
  }

  function importProjects(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        if (!Array.isArray(parsed.projects)) throw new Error("Missing projects array");
        const imported = parsed.projects.map((project: Partial<SupabaseProject>, index: number) => {
          if (!project.name || !project.url || typeof project.key !== "string") throw new Error(`Invalid project at row ${index + 1}`);
          const url = cleanUrl(String(project.url));
          new URL(url);
          return {
            id: project.id || crypto.randomUUID(),
            name: String(project.name).trim(),
            url,
            key: project.key.trim(),
            status: "idle" as ProjectStatus,
          };
        });
        setProjects(imported);
        if (TIMER_OPTIONS.includes(Number(parsed.intervalMinutes))) setIntervalMinutes(Number(parsed.intervalMinutes));
        if (typeof parsed.timerEnabled === "boolean") setTimerEnabled(parsed.timerEnabled);
        toast.success(`${imported.length} project${imported.length === 1 ? "" : "s"} restored`, { description: "Run a sweep to verify the imported keys." });
      } catch {
        toast.error("Could not import backup", { description: "Use a JSON backup exported from this dashboard." });
      }
    };
    reader.readAsText(file);
  }

  const configuredProjects = projects.filter((project) => project.key);

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileNavOpen ? "sidebar-open" : ""}`}>
        <div className="brand-lockup">
          <div className="brand-mark"><Database className="h-5 w-5" /></div>
          <div><p className="brand-name">Keepalive</p><p className="brand-subtitle">Supabase control room</p></div>
        </div>
        <div className="sidebar-nav-label">Workspace</div>
        <nav className="sidebar-nav">
          <button className="nav-item nav-item-active" onClick={() => setMobileNavOpen(false)}><Activity className="h-4 w-4" /> Overview <span className="nav-item-count">{stats.total}</span></button>
          <button className="nav-item" onClick={() => { setIsAdding(true); setMobileNavOpen(false); }}><Plus className="h-4 w-4" /> Add project <ChevronRight className="ml-auto h-4 w-4 opacity-50" /></button>
        </nav>
        <div className="sidebar-footer">
          <div className="security-note"><ShieldCheck className="h-4 w-4" /><div><p>Browser-only vault</p><span>Keys never leave this device.</span></div></div>
          <a className="help-link" href="https://supabase.com/docs/guides/platform/going-into-paused-state" target="_blank" rel="noreferrer"><CircleHelp className="h-4 w-4" /> Why projects pause <ArrowUpRight className="ml-auto h-3.5 w-3.5" /></a>
        </div>
      </aside>

      {mobileNavOpen && <button aria-label="Close navigation" className="mobile-overlay" onClick={() => setMobileNavOpen(false)} />}

      <main className="main-content">
        <header className="topbar">
          <button className="mobile-menu-button" onClick={() => setMobileNavOpen(true)} aria-label="Open navigation"><Menu className="h-5 w-5" /></button>
          <div className="breadcrumbs"><span>Workspace</span><ChevronRight className="h-3.5 w-3.5" /><strong>Overview</strong></div>
          <div className="topbar-actions"><span className="live-indicator"><span /> Local session</span><button className="icon-button" title="Help" onClick={() => toast("Add only Supabase anon/public keys, never service-role keys.")}><CircleHelp className="h-4 w-4" /></button></div>
        </header>

        <div className="content-wrap">
          <section className="hero-row">
            <div><p className="eyebrow"><span className="eyebrow-line" /> PROJECT HEALTH</p><h1>Stay ahead of<br /><em>the pause.</em></h1><p className="hero-copy">One quiet command center for every Supabase project you care about. Check availability, spot attention, and keep your workspace tidy.</p></div>
            <div className="hero-actions"><button className="button button-secondary" onClick={() => runChecks()} disabled={isRunningAll || !configuredProjects.length}><RefreshCw className={`h-4 w-4 ${isRunningAll ? "animate-spin" : ""}`} /> {isRunningAll ? "Checking…" : "Check all"}</button><button className="button button-primary" onClick={() => setIsAdding(true)}><Plus className="h-4 w-4" /> Add project</button></div>
          </section>

          <section className="stats-grid" aria-label="Workspace summary">
            <div className="stat-card stat-card-primary"><div className="stat-icon"><Server className="h-4 w-4" /></div><div><p className="stat-label">Tracked projects</p><p className="stat-value">{stats.total}</p></div><span className="stat-caption">in this browser</span></div>
            <div className="stat-card"><div className="stat-icon stat-icon-green"><CheckCircle2 className="h-4 w-4" /></div><div><p className="stat-label">Responding</p><p className="stat-value">{stats.online}</p></div><span className="stat-caption">last check</span></div>
            <div className="stat-card"><div className="stat-icon stat-icon-amber"><Clock3 className="h-4 w-4" /></div><div><p className="stat-label">Needs attention</p><p className="stat-value">{stats.attention}</p></div><span className="stat-caption">last check</span></div>
            <div className="stat-card stat-card-run"><div className="stat-run-top"><Zap className="h-4 w-4" /><span>Keepalive timer</span><button className={`timer-toggle ${timerEnabled ? "timer-toggle-on" : ""}`} onClick={() => setTimerEnabled((enabled) => !enabled)}>{timerEnabled ? "ON" : "OFF"}</button></div><div className="timer-controls"><select aria-label="Request interval" value={intervalMinutes} onChange={(event) => setIntervalMinutes(Number(event.target.value))} disabled={!timerEnabled}>{TIMER_OPTIONS.map((minutes) => <option key={minutes} value={minutes}>{minutes < 60 ? `${minutes} min` : minutes % 60 === 0 ? `${minutes / 60} hr` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`}</option>)}</select><span>between sweeps</span></div><p className="countdown-value">{timerEnabled ? countdown : "Paused"}</p><small>{timerEnabled ? "Until next browser sweep" : "Timer is paused"}</small></div>
          </section>

          <section className="section-heading"><div><p className="section-kicker">YOUR PROJECTS</p><h2>Project watchlist <span>{stats.total}</span></h2></div><div className="section-meta"><span className="pulse-dot" /> Read-only checks <span className="section-divider" /> <button onClick={exportProjects} disabled={!projects.length}><FileJson className="h-3.5 w-3.5" /> Backup</button><button onClick={() => importInputRef.current?.click()}><Upload className="h-3.5 w-3.5" /> Restore</button><span className="section-divider" /><button onClick={() => runChecks()} disabled={isRunningAll || !configuredProjects.length}>Run sweep <Play className="h-3.5 w-3.5" /></button></div></section>

          <section className="project-grid">
            {projects.map((project, index) => (
              <article className={`project-card ${project.status === "online" ? "project-online" : ""}`} key={project.id} style={{ animationDelay: `${index * 60}ms` }}>
                <div className="project-card-top"><div className="project-avatar">{project.name.slice(0, 1).toUpperCase()}</div><div className="project-title"><h3>{project.name}</h3><button className="project-url" onClick={() => copyUrl(project.url)} title="Copy project URL">{project.url.replace(/^https?:\/\//, "")}<Copy className="h-3 w-3" /></button></div><button className="delete-button" onClick={() => deleteProject(project.id)} title="Remove project"><Trash2 className="h-4 w-4" /></button></div>
                <div className="project-status-row"><StatusPill status={project.status} /> {project.latency ? <span className="latency">{project.latency}ms</span> : <span className="latency">{project.error ? "Request failed" : "Awaiting first check"}</span>}</div>
                <div className="project-key-row"><KeyRound className="h-3.5 w-3.5" /><span>{visibleKey === project.id ? project.key || "No key" : maskKey(project.key)}</span>{project.key && <button className="key-toggle" onClick={() => setVisibleKey(visibleKey === project.id ? null : project.id)} aria-label={visibleKey === project.id ? "Hide key" : "Show key"}>{visibleKey === project.id ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}</button>}</div>
                {project.error && <p className="error-copy">{project.error}</p>}
                <div className="project-card-bottom"><span className="last-checked">Last checked <strong>{formatTime(project.lastChecked)}</strong></span><button className="check-button" onClick={() => runSingle(project)} disabled={project.status === "checking"}><Play className="h-3.5 w-3.5" /> Test now</button></div>
              </article>
            ))}
            <button className="add-card" onClick={() => setIsAdding(true)}><span className="add-card-icon"><Plus className="h-5 w-5" /></span><span><strong>Add another project</strong><small>Use its anon/public key</small></span><ChevronRight className="ml-auto h-4 w-4" /></button>
          </section>

          <section className="trust-banner"><div className="trust-icon"><ShieldCheck className="h-5 w-5" /></div><div><strong>Designed to be safe by default</strong><p>Checks call <code>GET /auth/v1/health</code> only. No tables, rows, or columns are created or changed. Use an anon/public or publishable key—not a service-role key.</p></div><span className="trust-badge"><Check className="h-3.5 w-3.5" /> No writes</span></section>

          <footer className="page-footer"><span>Keepalive runs in your browser.</span><span>For 24/7 coverage with the tab closed, add the GitHub Action workflow and repository secret.</span></footer>
          <input ref={importInputRef} className="sr-only" type="file" accept="application/json,.json" onChange={importProjects} />
        </div>
      </main>

      {isAdding && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setIsAdding(false); }}><div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="add-project-title"><div className="modal-header"><div><p className="section-kicker">NEW CONNECTION</p><h2 id="add-project-title">Add a project</h2></div><button className="icon-button" onClick={() => setIsAdding(false)} aria-label="Close"><X className="h-5 w-5" /></button></div><form onSubmit={addProject}><label>Project name<input autoFocus value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="e.g. Marketing site" /></label><label>Project URL<input value={form.url} onChange={(event) => setForm({ ...form, url: event.target.value })} placeholder="https://your-project.supabase.co" /></label><label>Anon / public key<div className="input-with-icon"><input type="password" value={form.key} onChange={(event) => setForm({ ...form, key: event.target.value })} placeholder="eyJhbGciOiJIUzI1NiIs…" /><KeyRound className="h-4 w-4" /></div></label><div className="modal-warning"><ShieldCheck className="h-4 w-4" /><span>Stored only in this browser’s local storage. Never paste a service-role key here.</span></div><div className="modal-actions"><button type="button" className="button button-ghost" onClick={() => setIsAdding(false)}>Cancel</button><button type="submit" className="button button-primary"><Plus className="h-4 w-4" /> Add project</button></div></form></div></div>}
    </div>
  );
}

const raw = process.env.SUPABASE_PROJECTS_JSON;

if (!raw) {
  console.error("Missing SUPABASE_PROJECTS_JSON repository secret.");
  process.exit(1);
}

let payload;
try {
  payload = JSON.parse(raw);
} catch {
  console.error("SUPABASE_PROJECTS_JSON is not valid JSON.");
  process.exit(1);
}

const projects = Array.isArray(payload) ? payload : payload.projects;
if (!Array.isArray(projects) || projects.length === 0) {
  console.error("SUPABASE_PROJECTS_JSON must be an array or an object with a projects array.");
  process.exit(1);
}

const cleanUrl = (value) => String(value).trim().replace(/\/$/, "");

const results = await Promise.all(
  projects.map(async (project) => {
    const name = project.name || project.url || "Unnamed project";
    if (!project.url || !project.key) {
      return { name, ok: false, detail: "Missing url or key" };
    }

    try {
      const response = await fetch(`${cleanUrl(project.url)}/auth/v1/health`, {
        method: "GET",
        headers: { apikey: String(project.key).trim() },
        signal: AbortSignal.timeout(15000),
      });
      return {
        name,
        ok: response.ok,
        detail: response.ok ? `HTTP ${response.status}` : `HTTP ${response.status}`,
      };
    } catch (error) {
      return { name, ok: false, detail: error instanceof Error ? error.message : "Request failed" };
    }
  }),
);

for (const result of results) {
  console.log(`${result.ok ? "OK" : "FAIL"} ${result.name}: ${result.detail}`);
}

const summary = results.map((result) => `| ${result.ok ? "OK" : "FAIL"} | ${result.name.replaceAll("|", "\\|")} | ${result.detail} |`).join("\n");
if (process.env.GITHUB_STEP_SUMMARY) {
  const fs = await import("node:fs/promises");
  await fs.appendFile(process.env.GITHUB_STEP_SUMMARY, `## Supabase keepalive\n\n| Status | Project | Result |\n|---|---|---|\n${summary}\n`);
}

if (results.some((result) => !result.ok)) process.exit(1);

/**
 * Curation page HTTP helpers (Django proxy only).
 */

export function createCurationApi() {
  const api = {
    _writeHeaders() {
      const tokenFromWindow =
        typeof window !== "undefined" && typeof window.CURATION_WRITE_TOKEN === "string"
          ? window.CURATION_WRITE_TOKEN.trim()
          : "";
      const tokenFromStorage =
        typeof localStorage !== "undefined"
          ? (localStorage.getItem("curation_write_token") || "").trim()
          : "";
      const token = tokenFromWindow || tokenFromStorage;
      const headers = { "Content-Type": "application/json" };
      if (token) {
        headers["X-Curation-Write-Token"] = token;
      }
      return headers;
    },
    async projects() {
      const r = await fetch("/api/supabase/projects/");
      let body = {};
      const text = await r.text();
      try {
        body = text ? JSON.parse(text) : {};
      } catch (_) {
        if (r.status === 502 && /<title>.*502.*<\/title>/i.test(text)) {
          body = { error: "API unavailable (502). Ensure the backend (nur-api) is running and try again." };
        } else {
          body = { error: text ? text.slice(0, 200) : `Server returned ${r.status}` };
        }
      }
      if (!r.ok) {
        const msg = body.error || `Failed to load projects (${r.status}). Check API and Supabase configuration.`;
        throw new Error(msg);
      }
      return body;
    },
    async submissions(projectId) {
      const r = await fetch(
        `/api/supabase/projects/${projectId}/submissions/`
      );
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body.error || `Failed to load submissions (${r.status})`);
      return body;
    },
    async submissionsAll() {
      const r = await fetch("/api/supabase/submissions/");
      const body = await r.json().catch(() => null);
      if (!r.ok) {
        const msg =
          body && typeof body === "object" && !Array.isArray(body) && body.error
            ? body.error
            : `Failed to load submissions (${r.status})`;
        throw new Error(msg);
      }
      let raw = [];
      if (Array.isArray(body)) {
        raw = body;
      } else if (body && typeof body === "object") {
        if (Array.isArray(body.submissions)) {
          raw = body.submissions;
        } else if (Array.isArray(body.results)) {
          raw = body.results;
        }
      }
      return raw
        .filter((item) => item !== null && typeof item === "object")
        .map((item) => ({ ...item }));
    },
    async features(submissionId, options = {}) {
      const qs = new URLSearchParams();
      if (options && options.projectId) {
        qs.set("project_id", String(options.projectId));
      }
      if (options && Object.prototype.hasOwnProperty.call(options, "includeCurrent")) {
        qs.set("include_current", options.includeCurrent ? "true" : "false");
      }
      if (options && Object.prototype.hasOwnProperty.call(options, "includeHistory")) {
        qs.set("include_history", options.includeHistory ? "true" : "false");
      }
      const suffix = qs.toString() ? `?${qs.toString()}` : "";
      const r = await fetch(
        `/api/supabase/submissions/${submissionId}/features/${suffix}`
      );
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body.error || `Failed to load features (${r.status})`);
      return body;
    },
    async publish(name, geojsonItm, projectName) {
      const r = await fetch("/api/supabase/curated/publish/", {
        method: "POST",
        headers: api._writeHeaders(),
        body: JSON.stringify({
          name,
          geojson: geojsonItm,
          table: "otef",
          project_name: projectName,
        }),
      });
      const text = await r.text();
      let data = {};
      try {
        data = text ? JSON.parse(text) : {};
      } catch (_) {
        data = { error: r.status === 502 ? "API unavailable." : (text ? text.slice(0, 150) : "Request failed") };
      }
      const errMsg = data.error || data.detail || data.message;
      if (!r.ok) throw new Error(errMsg || `Publish failed (${r.status})`);
      return data;
    },
    async computeRoute(payload) {
      const r = await fetch("/api/supabase/curated/compute-route/", {
        method: "POST",
        headers: api._writeHeaders(),
        body: JSON.stringify(payload || {}),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body.error || `Route computation failed (${r.status})`);
      return body;
    },
    async editFeaturesBatch(payload) {
      const paths = [
        "/api/supabase/curated/edit-batch/",
        "/api/supabase/curated/edit-batch",
      ];
      let lastError = null;
      for (const path of paths) {
        const r = await fetch(path, {
          method: "POST",
          headers: api._writeHeaders(),
          body: JSON.stringify(payload),
        });
        const text = await r.text();
        let body = {};
        if (text) {
          try {
            body = JSON.parse(text);
          } catch (_) {
            body = {};
          }
        }
        if (r.ok) return body;
        const snippet =
          text && (!body || Object.keys(body).length === 0)
            ? text.replace(/\s+/g, " ").trim().slice(0, 200)
            : "";
        const jsonMsg = body.error || body.detail || body.message;
        const composed = jsonMsg
          ? `${jsonMsg} [${path} HTTP ${r.status}]`
          : snippet
            ? `Failed to save batch edits [${path} HTTP ${r.status}]: ${snippet}`
            : `Failed to save batch edits [${path} HTTP ${r.status}]`;
        if (r.status !== 404) throw new Error(composed);
        lastError = new Error(composed);
      }
      throw lastError || new Error("Failed to save batch edits (404)");
    },
    async editFeaturePosition(payload) {
      const paths = [
        "/api/supabase/curated/edit/",
        "/api/supabase/curated/edit",
        "/supabase/curated/edit/",
      ];
      let lastError = null;
      for (const path of paths) {
        const r = await fetch(path, {
          method: "POST",
          headers: api._writeHeaders(),
          body: JSON.stringify(payload),
        });
        const text = await r.text();
        let body = {};
        if (text) {
          try {
            body = JSON.parse(text);
          } catch (_) {
            body = {};
          }
        }
        if (r.ok) {
          return body;
        }
        const snippet =
          text && (!body || Object.keys(body).length === 0)
            ? text.replace(/\s+/g, " ").trim().slice(0, 200)
            : "";
        const jsonMsg = body.error || body.detail || body.message;
        const composed = jsonMsg
          ? `${jsonMsg} [${path} HTTP ${r.status}]`
          : snippet
            ? `Failed to save edit [${path} HTTP ${r.status}]: ${snippet}`
            : `Failed to save edit [${path} HTTP ${r.status}]`;
        if (typeof console !== "undefined" && console.debug) {
          console.debug("[curation] editFeaturePosition failed", {
            path,
            status: r.status,
            snippet: snippet || undefined,
            jsonKeys: body && typeof body === "object" ? Object.keys(body) : [],
          });
        }
        // Retry alternate URL forms only for "not found" routes.
        if (r.status !== 404) {
          throw new Error(composed);
        }
        lastError = new Error(composed);
      }
      throw lastError || new Error("Failed to save edit (404)");
    },
    async layerGroups(tableName) {
      const r = await fetch(`/api/otef_viewport/by-table/${encodeURIComponent(tableName)}/`);
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body.error || `Failed to load layer groups (${r.status})`);
      return body;
    },
    async activeGisLayers(tableName) {
      const r = await fetch(`/api/gis_layers/?table=${encodeURIComponent(tableName)}`);
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body.error || `Failed to load active layers (${r.status})`);
      return Array.isArray(body) ? body : [];
    },
    async unpublishCuratedLayer(payload) {
      const r = await fetch("/api/supabase/curated/unpublish/", {
        method: "POST",
        headers: api._writeHeaders(),
        body: JSON.stringify(payload),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body.error || `Failed to remove published layer (${r.status})`);
      return body;
    },
  };
  return api;
}

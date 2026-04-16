import { allStatements, rawStatements, currentPage, atRiskData } from './app.js';

let timeChart = null;
let userChart = null;
let completionChart = null;
let engagementChart = null;
let engagementBreakdownChart = null;

export const PAGE_SIZE = 50;

// =======================================================
// Render
// =======================================================
export function renderRaw() {
  const start = currentPage * PAGE_SIZE;
  const end = start + PAGE_SIZE;
  const pageStatements = allStatements.slice(start, end);
  const totalPages = Math.ceil(allStatements.length / PAGE_SIZE);

  const formatted = pageStatements.map((s, i) => {
    return `<details>
      <summary>Statement ${start + i + 1} — ${s.actor?.name ?? "Unknown"} | ${s.verb?.id?.split("/").pop()} | ${new Date(s.timestamp).toLocaleString()}</summary>
      <pre>${JSON.stringify(s, null, 2)}</pre>
    </details>`;
  }).join("");

  document.getElementById("raw-display").innerHTML = formatted || "No statements found.";

  document.getElementById("page-indicator").textContent =
    `Page ${currentPage + 1} of ${totalPages}`;

  document.getElementById("prev-btn").disabled = currentPage === 0;
  document.getElementById("next-btn").disabled = end >= allStatements.length;
}

// Renders a Data Table if selected
export function renderTable() {
  let rows = allStatements.map(s => {
    const name = s.actor.name ?? s.object?.id ?? "Unknown";
    const email = s.actor.mbox?.replace("mailto:", "") ?? s.actor.name ?? "Unknown";
    const verb = s.verb.id.split("/").pop();
    const video = s.object?.definition?.name?.["en-US"] ?? s.object?.id ?? "Unknown";
    const time = new Date(s.timestamp).toLocaleString();
    return `<tr><td>${name}</td><td>${email}</td><td>${verb}</td><td>${video}</td><td>${time}</td></tr>`;
  }).join("");

  document.getElementById("summary-display").innerHTML = `
    <table>
      <thead>
        <tr><th>Name</th><th>Email</th><th>Verb</th><th>Video</th><th>Date and Time</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

//Renders a Chart
export function renderUserCharts() {
  renderActionsOverTime();
  renderActivityPerUser();
  renderAtRisk();
  renderEngagement();
}

export function renderVideoCharts() {
  renderCompletionRate();
  populateHeatmapVideoList();
}

function renderActionsOverTime() {
  const timeCounts = {};
  allStatements.forEach(s => {
    const date = new Date(s.timestamp).toLocaleDateString();
    timeCounts[date] = (timeCounts[date] ?? 0) + 1;
  });
  const sortedDates = Object.keys(timeCounts).sort((a, b) => new Date(a) - new Date(b));
  const timeValues = sortedDates.map(d => timeCounts[d]);

  if (timeChart) timeChart.destroy();
  timeChart = new Chart(document.getElementById("activity-time-chart"), {
    type: "line",
    data: {
      labels: sortedDates,
      datasets: [{
        label: "Statements",
        data: timeValues,
        borderColor: "#1a73e8",
        backgroundColor: "rgba(26, 115, 232, 0.1)",
        tension: 0.3,
        fill: true
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } }
    }
  });
}

function renderActivityPerUser() {
  const userCounts = {};
  allStatements.forEach(s => {
    const actor = s.actor.mbox?.replace("mailto:", "") ?? s.actor.name ?? "Unknown";
    userCounts[actor] = (userCounts[actor] ?? 0) + 1;
  });
  const sortedUsers = Object.keys(userCounts).sort((a, b) => userCounts[b] - userCounts[a]);
  const userValues = sortedUsers.map(u => userCounts[u]);
  const colours = sortedUsers.map((_, i) => `hsl(${(i * 37) % 360}, 70%, 55%)`);

  if (userChart) userChart.destroy();
  userChart = new Chart(document.getElementById("activity-user-chart"), {
    type: "bar",
    data: {
      labels: sortedUsers,
      datasets: [{
        label: "Statements",
        data: userValues,
        backgroundColor: colours
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        y: { beginAtZero: true, ticks: { stepSize: 1 } },
        x: { ticks: { maxRotation: 45, minRotation: 45 } }
      }
    }
  });
}

export function renderCompletionRate() {
  console.log("Completion Rate:", rawStatements)
  const strictMode = document.getElementById("strict-mode-completion").checked;
  const videoAttempts = {};
  const videoCompletions = {};
  const videoFailed = {};
  const videoPassed = {};

  rawStatements.forEach(s => {
    const video = s.object?.definition?.name?.["en-US"] ?? "Unknown";
    const actor = s.actor.mbox?.replace("mailto:", "") ?? s.actor.name ?? "Unknown";
    const verb = s.verb.id;

    if (verb.includes("attempted")) {
      if (!videoAttempts[video]) videoAttempts[video] = new Set();
      videoAttempts[video].add(actor);
    }

    if (verb.includes("completed")) {
      if (!videoCompletions[video]) videoCompletions[video] = new Set();
      videoCompletions[video].add(actor);
    }

    if (verb.includes("passed")) {
      if (!videoPassed[video]) videoPassed[video] = new Set();
      videoPassed[video].add(actor);    
    }

    if (verb.includes("failed")) {
      if (!videoFailed[video]) videoFailed[video] = new Set();
      videoFailed[video].add(actor);
    }
  });

  // Calculate completion rate per video
  const videos = Object.keys(videoAttempts);
  const attempted = videos.map(v => videoAttempts[v]?.size ?? 0);
  const completed = videos.map(v => {
    if (strictMode) {
      return videoPassed[v]?.size ?? 0;
    } else {
      const completedSet = videoCompletions[v] ?? new Set();
      const passedSet = videoPassed[v] ?? new Set();
      return new Set([...completedSet, ...passedSet]).size;
    }
  });

  const rates = videos.map((v, i) =>
    attempted[i] > 0 ? Math.round((completed[i] / attempted[i]) * 100) : 0
  );

  // Colour code: green if >=70%, orange if >=40%, red if <40%
  const colours = rates.map(r =>
    r >= 70 ? "rgba(52, 168, 83, 0.8)"  // green
    : r >= 40 ? "rgba(251, 188, 4, 0.8)" // orange
    : "rgba(234, 67, 53, 0.8)"           // red
  );

  const labels = videos.map((v, i) =>
    `${v} (${completed[i]}/${attempted[i]})`
  );

  if (completionChart) completionChart.destroy();
  completionChart = new Chart(
    document.getElementById("completion-rate-chart"),
    {
      type: "bar",
      data: {
        labels: labels,
        datasets: [{
          label: "Completion Rate (%)",
          data: rates,
          backgroundColor: colours
        }]
      },
      options: {
        indexAxis: "y", // ← makes it horizontal
        responsive: true,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: ctx => {
                const i = ctx.dataIndex;
                return [
                  `Completion rate: ${ctx.raw}%`,
                  `Completed/Passed: ${completed[i]}`,
                  `Attempted: ${attempted[i]}`,
                  `Failed: ${videoFailed[videos[i]]?.size ?? 0}`,
                  strictMode ? "(Strict — passed only)" : "(Lenient — completed counts)"
                ];
              }
            }
          }
        },
        scales: {
          x: {
            beginAtZero: true,
            max: 100,
            ticks: {
              callback: val => `${val}%`
            }
          }
        }
      }
    }
  );
}

export function renderAtRisk() {
  const strictMode = document.getElementById("strict-mode-risk").checked;

  const outcomes = {};

  const sorted = [...rawStatements].sort((a, b) =>
    new Date(a.timestamp) - new Date(b.timestamp)
  );

  sorted.forEach(s => {
    const actor = s.actor?.mbox?.replace("mailto:", "") ?? s.actor?.name ?? "Unknown";
    const name  = s.actor?.name ?? actor; // fallback to email if no name
    const verb    = s.verb?.id ?? "";
    const videoId = s.object?.id;
    if (!videoId) return;

    if (!outcomes[actor]) outcomes[actor] = { name, videos: {} };
    if (!outcomes[actor].videos[videoId]) outcomes[actor].videos[videoId] = { attempts: 0, finalVerb: null };

    // Always update name in case earlier statements lacked it
    if (s.actor?.name) outcomes[actor].name = s.actor.name;

    if (verb.includes("attempted")) outcomes[actor].videos[videoId].attempts++;
    if (verb.includes("passed"))     outcomes[actor].videos[videoId].finalVerb = "passed";
    if (verb.includes("failed"))     outcomes[actor].videos[videoId].finalVerb = "failed";
    if (verb.includes("completed"))  outcomes[actor].videos[videoId].finalVerb = "completed";
    if (verb.includes("terminated")) {
      if (!["passed", "completed"].includes(outcomes[actor].videos[videoId].finalVerb)) {
        outcomes[actor].videos[videoId].finalVerb = "terminated";
      }
    }
  });

  const actorData = Object.entries(outcomes).map(([actor, data]) => {
    const { name, videos } = data;
    let attempts = 0, completions = 0, failed = 0, terminated = 0;

    Object.values(videos).forEach(v => {
      attempts += v.attempts;
      if (strictMode) {
        if (v.finalVerb === "passed") completions++;
      } else {
        if (v.finalVerb === "passed" || v.finalVerb === "completed") completions++;
      }
      if (v.finalVerb === "failed")     failed++;
      if (v.finalVerb === "terminated") terminated++;
    });

    const totalVideos = Object.keys(videos).length;
    const rate = totalVideos > 0 ? Math.round((completions / totalVideos) * 100) : 0;

    let risk;
    if (rate === 0 && terminated > 0)          risk = "high";
    else if (rate < 50)                        risk = "high";
    else if (rate < 70 || failed > completions) risk = "medium";
    else                                        risk = "low";

    return { name, actor, attempts, completions, failed, terminated, rate, risk };
  });

  actorData.sort((a, b) => a.rate - b.rate);
  atRiskData.length = 0;
  atRiskData.push(...actorData);

  // ── Engagement Chart ──────────────────
  const labels  = actorData.map(d => d.actor);
  const rates   = actorData.map(d => d.rate);
  const colours = actorData.map(d =>
    d.risk === "high"   ? "rgba(234, 67, 53, 0.8)"
    : d.risk === "medium" ? "rgba(251, 188, 4, 0.8)"
    : "rgba(52, 168, 83, 0.8)"
  );

  if (engagementChart) engagementChart.destroy();
  engagementChart = new Chart(
    document.getElementById("engagement-chart"),
    {
      type: "bar",
      data: {
        labels,
        datasets: [{ label: "Completion Rate (%)", data: rates, backgroundColor: colours }]
      },
      options: {
        indexAxis: "y",
        responsive: true,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: ctx => {
                const d = actorData[ctx.dataIndex];
                return [
                  `Name: ${d.name}`,
                  `Completion rate: ${ctx.raw}%`,
                  `Completed: ${d.completions}`,
                  `Attempted: ${d.attempts}`,
                  `Failed: ${d.failed}`,
                  `Terminated early: ${d.terminated}`,
                  `Risk: ${d.risk.toUpperCase()}`
                ];
              }
            }
          }
        },
        scales: {
          x: { beginAtZero: true, max: 100, ticks: { callback: val => `${val}%` } }
        }
      }
    }
  );

  // ── At-Risk Table ─────────────────────
  const riskIcon = { high: "🔴", medium: "🟡", low: "🟢" };
  const rows = actorData.map(d => `
    <tr class="risk-${d.risk}">
      <td>${d.name}</td>
      <td>${riskIcon[d.risk]} ${d.actor}</td>
      <td>${d.attempts}</td>
      <td>${d.completions}</td>
      <td>${d.failed}</td>
      <td>${d.terminated}</td>
      <td>${d.rate}%</td>
      <td>${d.risk.toUpperCase()}</td>
    </tr>
  `).join("");

  document.getElementById("at-risk-table").innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Name</th>
          <th>Email</th>
          <th>Attempted</th>
          <th>Completed</th>
          <th>Failed</th>
          <th>Terminated</th>
          <th>Rate</th>
          <th>Risk Level</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function renderEngagement() {
  const actorVerbs = {};

  allStatements.forEach(s => {
    const actor = s.actor.mbox?.replace("mailto:", "") ?? s.actor.name ?? "Unknown";
    const verb = s.verb.id;

    if (!actorVerbs[actor]) {
      actorVerbs[actor] = {
        initialized: 0,
        played: 0,
        paused: 0,
        seeked: 0,
        interacted: 0,
        answered: 0,
        terminated: 0,
        completed: 0,
        passed: 0,
        failed: 0
      };
    }

    if (verb.includes("initialized"))       actorVerbs[actor].initialized++;
    else if (verb.includes("played"))        actorVerbs[actor].played++;
    else if (verb.includes("paused"))        actorVerbs[actor].paused++;
    else if (verb.includes("seeked"))        actorVerbs[actor].seeked++;
    else if (verb.includes("interacted"))    actorVerbs[actor].interacted++;
    else if (verb.includes("answered"))      actorVerbs[actor].answered++;
    else if (verb.includes("terminated"))    actorVerbs[actor].terminated++;
    else if (verb.includes("completed"))     actorVerbs[actor].completed++;
    else if (verb.includes("passed"))        actorVerbs[actor].passed++;
    else if (verb.includes("failed"))        actorVerbs[actor].failed++;
  });

  // Sort actors by total engagement descending
  const actors = Object.keys(actorVerbs).sort((a, b) => {
    const totalA = Object.values(actorVerbs[a]).reduce((s, v) => s + v, 0);
    const totalB = Object.values(actorVerbs[b]).reduce((s, v) => s + v, 0);
    return totalB - totalA;
  });

  if (engagementBreakdownChart) engagementBreakdownChart.destroy();
  engagementBreakdownChart = new Chart(
    document.getElementById("engagement-breakdown-chart"),
    {
      type: "bar",
      data: {
        labels: actors,
        datasets: [
          { label: "Initialized",  data: actors.map(a => actorVerbs[a].initialized),  backgroundColor: "rgba(100, 181, 246, 0.8)" },  // light blue
          { label: "Played",       data: actors.map(a => actorVerbs[a].played),        backgroundColor: "rgba(26, 115, 232, 0.8)"  },  // blue
          { label: "Paused",       data: actors.map(a => actorVerbs[a].paused),        backgroundColor: "rgba(251, 188, 4, 0.8)"   },  // yellow
          { label: "Seeked",       data: actors.map(a => actorVerbs[a].seeked),        backgroundColor: "rgba(255, 167, 38, 0.8)"  },  // orange
          { label: "Interacted",   data: actors.map(a => actorVerbs[a].interacted),    backgroundColor: "rgba(156, 39, 176, 0.8)"  },  // purple
          { label: "Answered",     data: actors.map(a => actorVerbs[a].answered),      backgroundColor: "rgba(0, 188, 212, 0.8)"   },  // cyan
          { label: "Terminated",   data: actors.map(a => actorVerbs[a].terminated),    backgroundColor: "rgba(158, 158, 158, 0.8)" },  // grey
          { label: "Completed",    data: actors.map(a => actorVerbs[a].completed),     backgroundColor: "rgba(52, 168, 83, 0.8)"   },  // green
          { label: "Passed",       data: actors.map(a => actorVerbs[a].passed),        backgroundColor: "rgba(0, 150, 136, 0.8)"   },  // teal
          { label: "Failed",       data: actors.map(a => actorVerbs[a].failed),        backgroundColor: "rgba(234, 67, 53, 0.8)"   }   // red
        ]
      },
      options: {
        responsive: true,
        plugins: {
          legend: { display: true, position: "top" },
          tooltip: {
            callbacks: {
              afterBody: ctx => {
                const actor = actors[ctx[0].dataIndex];
                const total = Object.values(actorVerbs[actor]).reduce((s, v) => s + v, 0);
                const level = total >= 15 ? "🟢 HIGH" : total >= 7 ? "🟡 MEDIUM" : "🔴 LOW";
                return [`Total: ${total} interactions`, `Engagement: ${level}`];
              }
            }
          }
        },
        scales: {
          x: { stacked: true, ticks: { maxRotation: 45, minRotation: 45 } },
          y: { stacked: true, beginAtZero: true, ticks: { stepSize: 1 } }
        }
      }
    }
  );
}



const heatmapCharts = {};

function populateHeatmapVideoList() {
  const container = document.getElementById("heatmap-video-list");
  container.innerHTML = "";

  // Collect unique videos from statements
  const videos = new Map();
  allStatements.forEach(s => {
    const id    = s.object?.id;
    const title = s.object?.definition?.name?.["en-US"] ?? id;
    if (id && !videos.has(id)) videos.set(id, title);
  });

  if (videos.size === 0) {
    container.innerHTML = "<p>No video data found.</p>";
    return;
  }

  // Create a chart container for each video
  videos.forEach((title, videoId) => {
    const wrapper = document.createElement("div");
    wrapper.className = "heatmap-video-wrapper";
    wrapper.innerHTML = `
      <h4 class="heatmap-video-title">${title}</h4>
      <canvas id="heatmap-chart-${CSS.escape(videoId)}"></canvas>
    `;
    container.appendChild(wrapper);
  });

  renderAllHeatmaps();
}

export function renderAllHeatmaps() {
  const showPaused     = document.getElementById("heatmap-paused").checked;
  const showSeeked     = document.getElementById("heatmap-seeked").checked;
  const showPlayed     = document.getElementById("heatmap-played").checked;
  const showInteracted = document.getElementById("heatmap-interacted").checked;
  const bucketSize     = parseInt(document.getElementById("heatmap-bucket").value);

  const TIME_EXT      = "https://w3id.org/xapi/video/extensions/time";
  const TIME_FROM_EXT = "https://w3id.org/xapi/video/extensions/time-from";
  const TIME_TO_EXT   = "https://w3id.org/xapi/video/extensions/time-to";

  // Group statements by video
  const byVideo = new Map();
  allStatements.forEach(s => {
    const id = s.object?.id;
    if (!id) return;
    if (!byVideo.has(id)) byVideo.set(id, []);
    byVideo.get(id).push(s);
  });

  byVideo.forEach((statements, videoId) => {
    renderVideoHeatmap(videoId, statements, {
      showPaused, showSeeked, showPlayed, showInteracted,
      bucketSize,
      TIME_EXT, TIME_FROM_EXT, TIME_TO_EXT
    });
  });
}

function renderVideoHeatmap(videoId, statements, opts) {
  const {
    showPaused, showSeeked, showPlayed, showInteracted,
    bucketSize,
    TIME_EXT, TIME_FROM_EXT, TIME_TO_EXT
  } = opts;

  const canvasId = `heatmap-chart-${CSS.escape(videoId)}`;
  const canvas   = document.getElementById(canvasId);
  if (!canvas) return;

  // Infer video length from highest time value in this video's statements
  let maxTime = 0;
  statements.forEach(s => {
    const ext = s.context?.extensions ?? {};
    maxTime = Math.max(
      maxTime,
      ext[TIME_EXT]      ?? 0,
      ext[TIME_FROM_EXT] ?? 0,
      ext[TIME_TO_EXT]   ?? 0
    );
  });

  // Destroy old chart if it exists
  if (heatmapCharts[videoId]) {
    heatmapCharts[videoId].destroy();
    delete heatmapCharts[videoId];
  }

  if (maxTime === 0) {
    // No time data for this video — show a placeholder instead of a broken chart
    canvas.style.display = "none";
    const placeholder = canvas.parentElement.querySelector(".heatmap-no-data");
    if (!placeholder) {
      const p = document.createElement("p");
      p.className    = "heatmap-no-data";
      p.textContent  = "No interaction data for this video.";
      canvas.parentElement.appendChild(p);
    }
    return;
  }

  // Remove placeholder if it was previously shown
  canvas.style.display = "";
  const placeholder = canvas.parentElement.querySelector(".heatmap-no-data");
  if (placeholder) placeholder.remove();

  // Build buckets
  const bucketCount        = Math.ceil(maxTime / bucketSize);
  const pausedBuckets      = new Array(bucketCount).fill(0);
  const seekedBuckets      = new Array(bucketCount).fill(0);
  const playedBuckets      = new Array(bucketCount).fill(0);
  const interactedBuckets  = new Array(bucketCount).fill(0);

  const bucket = (time) => Math.min(Math.floor(time / bucketSize), bucketCount - 1);

  statements.forEach(s => {
    const verb = s.verb?.id ?? "";
    const ext  = s.context?.extensions ?? {};
    const t     = ext[TIME_EXT]      ?? null;
    const tFrom = ext[TIME_FROM_EXT] ?? null;
    const tTo   = ext[TIME_TO_EXT]   ?? null;

    if (showPaused     && verb.includes("paused")     && t     !== null) pausedBuckets[bucket(t)]++;
    if (showPlayed     && verb.includes("played")     && t     !== null) playedBuckets[bucket(t)]++;
    if (showInteracted && verb.includes("interacted") && t     !== null) interactedBuckets[bucket(t)]++;
    if (showSeeked     && verb.includes("seeked")) {
      if (tFrom !== null) seekedBuckets[bucket(tFrom)]++;
      if (tTo   !== null) seekedBuckets[bucket(tTo)]++;
    }
  });

  // Labels — MM:SS
  const labels = Array.from({ length: bucketCount }, (_, i) => {
    const secs = i * bucketSize;
    const m    = Math.floor(secs / 60).toString().padStart(2, "0");
    const s    = (secs % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  });

  // Datasets
  const datasets = [];
  if (showPaused)     datasets.push({ label: "Paused",      data: pausedBuckets,     backgroundColor: "rgba(251, 188,  4, 0.8)", stack: "heatmap" });
  if (showSeeked)     datasets.push({ label: "Seeked",      data: seekedBuckets,     backgroundColor: "rgba( 26, 115, 232, 0.8)", stack: "heatmap" });
  if (showPlayed)     datasets.push({ label: "Played",      data: playedBuckets,     backgroundColor: "rgba( 52, 168,  83, 0.8)", stack: "heatmap" });
  if (showInteracted) datasets.push({ label: "Interacted",  data: interactedBuckets, backgroundColor: "rgba(203,  46,  46, 0.8)", stack: "heatmap" });

  heatmapCharts[videoId] = new Chart(canvas, {
    type: "bar",
    data: { labels, datasets },
    options: {
      responsive: true,
      plugins: {
        legend: { display: true, position: "top" },
        tooltip: {
          callbacks: {
            title: ctx => {
              const i   = ctx[0].dataIndex;
              const end = labels[Math.min(i + 1, bucketCount - 1)];
              return `${ctx[0].label} — ${end}`;
            },
            label: ctx => `${ctx.dataset.label}: ${ctx.raw} event${ctx.raw !== 1 ? "s" : ""}`
          }
        }
      },
      scales: {
        x: {
          stacked: true,
          title: { display: true, text: "Video Position (MM:SS)" },
          ticks: { maxTicksLimit: 20, maxRotation: 45, minRotation: 45 }
        },
        y: {
          stacked: true,
          beginAtZero: true,
          title: { display: true, text: "Number of Events" },
          ticks: { stepSize: 1 }
        }
      }
    }
  });
}

export function renderSalesforceLeads(leads) {
  const display = document.getElementById("salesforce-display");

  if (!leads || leads.length === 0) {
    display.innerHTML = "No leads found.";
    return;
  }

  const rows = leads.map(lead => `
    <tr>
      <td>${lead.Id ?? "—"}</td>
      <td>${lead.Name ?? "—"}</td>
      <td>${lead.Email ?? "—"}</td>
      <td>${lead.Description ?? "—"}</td>
    </tr>
  `).join("");

  display.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>ID</th>
          <th>Name</th>
          <th>Email</th>
          <th>Description</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}
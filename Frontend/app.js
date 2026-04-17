import { floodDatabase, CLASSROOM } from './flood.js';
import { renderRaw, renderTable, renderUserCharts, renderVideoCharts, PAGE_SIZE, renderAtRisk, renderCompletionRate, renderAllHeatmaps, renderSalesforceLeads } from './render.js';

// The lambda array for frontend to connect to
export const LAMBDA_URL = "https://biwtdm5hdf.execute-api.us-east-1.amazonaws.com/default/dpblog-backend";

// Variables relating to 
let CURRENT_VIDEO_ID = null; // Video ID of the current video displayed in the video player
const MY_FOLDER = "Dustin Phan"; // Name of the folder valid videos are in

// Variables relating to the login
let isTest = false;
let currentUser = null; // { email, name, token }
let isLoggedIn = false;

// Default Actor
const ACTOR = {
  objectType: "Agent",
  name: "Anonymous",
  mbox: "mailto:diffrent@test.com"
};

// Chart and table data
export let allStatements = [];
export let rawStatements = [];
export let currentPage = 0;
export let potentialLeadData = [];


// ----------------------------------------- Event Handler ----------------------------------------
document.addEventListener("DOMContentLoaded", async () => {
  // Restores any previous sessions
  restoreSession();
  await handleGoogleCallback();

  // Initialize Page
  await loadVideoList();
  await loadVideoDropdown();
  await loadActorDropdown();
  initMultiSelect("actor-btn", "actor-dropdown", "All Users");
  initMultiSelect("verb-btn",  "verb-dropdown",  "All Verbs");
  initMultiSelect("video-btn", "video-dropdown", "All Videos");

  // Initialize chart data
  fetchRawStatements();

  // LRS initialization
  const lrsBtn = document.getElementById("lrs-btn");
  const lrsDropdown = document.getElementById("lrs-dropdown");
  lrsBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    lrsDropdown.classList.toggle("hidden");
  });

  lrsDropdown.addEventListener("change", () => {
    const selected = document.querySelector('input[name="lrs"]:checked');
    const icons = { scorm: "🟢", lrsql: "🔵" };
    const names = { scorm: "SCORM Cloud", lrsql: "SQL LRS (local)" };
    lrsBtn.textContent = `🗄️ ${names[selected.value]} ▾`;
    lrsDropdown.classList.add("hidden");
  });

  document.addEventListener("click", () => {
    lrsDropdown.classList.add("hidden");
  });

  // Initialized webpage tab
  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const targetTab = btn.dataset.tab;

      document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
      document.querySelectorAll(".tab-content").forEach(c => c.classList.add("hidden"));

      btn.classList.add("active");
      document.getElementById(btn.dataset.tab).classList.remove("hidden");

      if (targetTab === "tab-player" || targetTab == "tab-salesforce") {
        document.getElementById("search-bar").classList.add("hidden");
      } else {
        document.getElementById("search-bar").classList.remove("hidden");
      }

      if (allStatements.length > 0) {
        if (targetTab === "tab-raw") renderRaw();
        if (targetTab === "tab-table") renderTable();
        if (targetTab === "tab-charts") renderUserCharts();
        if (targetTab === "tab-video") renderVideoCharts();
      }
    });
  });

  // Sends custom statements to the LRS seperate from Hihaho xAPI implementation
  // FIXME: Currently very outdates, sending only 4 statements not exactly in the format of Hihaho xAPI statement. Flood LRS can be used as template if desired.
  window.addEventListener("message", (event) => {
    if (!event.origin.includes("hihaho.com")) return;

    let msg;
    try {
      msg = typeof event.data === "string"
        ? JSON.parse(event.data)
        : event.data;
    } catch (err) {
      console.error("Failed to parse message:", err);
      return;
    }

    if (msg.type === "documentTrigger") {
      const triggerName = msg.triggerName;

      if (triggerName === "hihaho_started") sendStatement(getActor(), "http://adlnet.gov/expapi/verbs/attempted", CURRENT_VIDEO_ID);
      if (triggerName === "hihaho_ended") sendStatement(getActor(), "http://adlnet.gov/expapi/verbs/completed", CURRENT_VIDEO_ID);
      if (triggerName === "hihaho_paused") sendStatement(getActor(), "https://w3id.org/xapi/video/verbs/paused", CURRENT_VIDEO_ID, { "https://w3id.org/xapi/video/extensions/time": msg.vars?.currentTime ?? null });
      if (triggerName === "hihaho_chapter_item_clicked") {
        const tabTitle = msg.triggerData.chapterItem.title
        console.log("Menu Item:", tabTitle);
        sendStatement(getActor(), "http://adlnet.gov/expapi/verbs/interacted", CURRENT_VIDEO_ID, 
          { "https://yourblog.com/extensions/menu-tab-clicked": tabTitle }
        );
      }
    }
  });

  //Move between tabs in RAW JSON tab
  document.getElementById("prev-btn").addEventListener("click", () => {
    if (currentPage > 0) { currentPage--; renderRaw(); }
  });
  document.getElementById("next-btn").addEventListener("click", () => {
    if ((currentPage + 1) * PAGE_SIZE < allStatements.length) { currentPage++; renderRaw(); }
  });

  // Floods the database with fake users
  document.getElementById("flood-btn").addEventListener("click", async () => {
    floodDatabase();
  });

  //Searches the LRS for data
  document.getElementById("search-btn").addEventListener("click", async () => {
    searchLRS();
  });

  //Convert Statements to CVS for exporting
  document.getElementById("download-btn").addEventListener("click", async () => {
    exportStatementsToCSV();
  });

  // Test Toggle
  const checkbox = document.getElementById("isTest-checkbox");
  checkbox.addEventListener("change", async () => {
    isTest = checkbox.checked;
    fetchRawStatements();
    console.log("isTest:", isTest);

    loadVideoDropdown();
  });

  // Updates the heatmap
  ["heatmap-paused", "heatmap-seeked", "heatmap-played","heatmap-interacted" ].forEach(id => {
    const el = document.getElementById(id);
    console.log(id, "→", el); // ← add this
    el?.addEventListener("change", renderAllHeatmaps);
  });
  document.getElementById("heatmap-bucket")?.addEventListener("input", renderAllHeatmaps);

  // Search Button
  document.getElementById("search-btn").addEventListener("click", async () => {
    searchLRS();
  });

  // Login button
  document.getElementById("auth-btn").addEventListener("click", async () => {
    console.log("Auth Button Hit");
    if (isLoggedIn) logout();
    else initGoogleAuth();
  });

  // Retrieves Salesforce Leads
  document.getElementById("salesforce-btn").addEventListener("click", async () => {
    const leads = await retrieveSalesforceLead();
    renderSalesforceLeads(leads);
  });

  // Forwards potential leads to salesforce
  document.getElementById("send-leads-btn").addEventListener("click", async () => {
    sendSalesforceLead();
  });
});


// ---------------------------------------------- Search Bar Function -----------------------------------------------------
// Retrieves all checked values from multi-select bar
function getCheckedValues(dropdownId) {
  const checked = [...document.querySelectorAll(`#${dropdownId} input[type="checkbox"]:checked`)]
    .map(cb => cb.value)
    .filter(v => v !== ""); // exclude "All" option
  return checked;
}

// Updates the labels on the multiselect button
function updateBtnLabel(btnId, dropdownId, defaultLabel) {
  const checked = getCheckedValues(dropdownId);
  const btn = document.getElementById(btnId);
  if (checked.length === 0) btn.textContent = `${defaultLabel} ▾`;
  else btn.textContent = `${checked.length} selected ▾`;
}

// Initializes the multi-select input
function initMultiSelect(btnId, dropdownId, defaultLabel) {
  const btn = document.getElementById(btnId);
  const dropdown = document.getElementById(dropdownId);

  // Toggle dropdown on button click
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    dropdown.classList.toggle("hidden");
  });

  // Update label when checkbox changes
  dropdown.addEventListener("change", () => {
    updateBtnLabel(btnId, dropdownId, defaultLabel);
  });

  // Close when clicking outside
  document.addEventListener("click", () => {
    dropdown.classList.add("hidden");
  });
}

// Loads videos in the video dropdown
async function loadVideoDropdown() {
  try {
    const dropdown = document.getElementById("video-dropdown");
    dropdown.innerHTML = "";

    const response = await fetch(`${LAMBDA_URL}/videos?test=${isTest}`);
    const data = await response.json();
    console.log("Data: ", data);
    const divider = document.createElement("div");
    divider.className = "dropdown-group-label";

    if (!isTest) {
      const videos = (data.data ?? []).filter(v =>
        v.status === 1 && v.video_container?.name === MY_FOLDER
      );

      divider.textContent = "Hihaho Videos";
      dropdown.appendChild(divider);

      videos.forEach(video => {
        const label = document.createElement("label");
        label.className = "multi-select-option";
        label.innerHTML = `<input type="checkbox" value="https://player.hihaho.com/embed/${video.uuid}" /> ${video.display_name ?? "Untitled"}`;
        dropdown.appendChild(label);
      });
      console.log("Hihaho Video Dropdown Loaded");

    } else {
      const videos = (data.data ?? []).filter(v => v.status === 1);

      divider.textContent = "Test Videos";
      dropdown.appendChild(divider);

      videos.forEach(video => {
        const label = document.createElement("label");
        label.className = "multi-select-option";
        label.innerHTML = `<input type="checkbox" value="${video.embed_url}" /> ${video.display_name ?? "Untitled"}`;
        dropdown.appendChild(label);
      });
      console.log("Test Video Dropdown Loaded");

    }
  } catch (err) {
    console.error("Failed to load video dropdown:", err);
  }
}

// Loads Actors in the Actor Dropdown
function loadActorDropdown() {
  if (isTest){
    const dropdown = document.getElementById("actor-dropdown");
    CLASSROOM.forEach(student => {
      const label = document.createElement("label");
      label.className = "multi-select-option";
      label.innerHTML = `<input type="checkbox" value="${student.email}" /> ${student.name}`;
      dropdown.appendChild(label);
    });
  } else {
    const dropdown = document.getElementById("actor-dropdown");
    CLASSROOM.forEach(student => {
      const label = document.createElement("label");
      label.className = "multi-select-option";
      label.innerHTML = `<input type="checkbox" value="${student.email}" /> ${student.name}`;
      dropdown.appendChild(label);
    });
  }
}


// -------------------------------- Video Player Tab Functions ------------------------------------
// Loads a correct list of videos to select 
async function loadVideoList() {
  try {
    // Retrieves and filters the correct videos
    const response = await fetch(`${LAMBDA_URL}/videos?test=false`);
    const data = await response.json();
    const videos = (data.data ?? []).filter(v => v.status === 1 && v.video_container?.name === MY_FOLDER); // v.status refers to whether the video is published (1)
    const listEl = document.getElementById("video-list");
    listEl.innerHTML = "";

    // Displays the correct video's title and id into the embedded source and UI
    videos.forEach(video => {
      const item = document.createElement("div");
      item.className = "video-item";
      item.id = `video-${video.uuid}`;
      item.textContent = video.display_name ?? "Untitled Video";
      item.addEventListener("click", () => {
        loadVideo(video.uuid, video.display_name, video.id);
      });
      listEl.appendChild(item);
    });
  } catch (err) {
    document.getElementById("video-list").textContent = "Failed to load videos.";
    console.error(err);
  }
}

function loadVideo(videoUUID, title, videoID) {
  document.getElementById("video-title").textContent = title;

  const base = `https://player.hihaho.com/embed/${videoUUID}?api=true`;
  const src  = currentUser
    ? `${base}&email=${encodeURIComponent(currentUser.email)}`
    : base;

  document.getElementById("hihaho-iframe").src = src;
  CURRENT_VIDEO_ID = videoID;

  document.querySelectorAll(".video-item").forEach(el => el.classList.remove("active"));
  document.getElementById(`video-${videoUUID}`)?.classList.add("active");
}


// ------------------------- Set LRS ----------------------------------------
// Sets the current active LRS
function getActiveLRS() {
  const lrs = isTest ? "scorm_test" : document.querySelector('input[name="lrs"]:checked')?.value ?? "scorm";
  console.log("Current LRS:", lrs);
  return lrs;
}

// -------------------------------------------------- xAPI Functions -------------------------------------------------------
function sendStatement(actor, verbID, videoID, extensions = {}) {
 // Verifies current session
  const headers = { "Content-Type": "application/json" };
  if (currentUser?.sessionToken) {
    headers["x-session-token"] = currentUser.sessionToken;
  }

  //Send Endpoint
  fetch(`${LAMBDA_URL}/statements`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ 
      actor: actor,
      verbId: verbID,
      videoId: videoID,
      lrs: getActiveLRS(),
      extensions: extensions
    })
  })
  .then(res => res.json())
  .then(data => console.log(`${data.message}`))
  .catch(err => console.log(`Failed to send statement: ${err}`));
}

// ------------------------------------ Search -----------------------------------
// NOTE: When using test statements, the timestamp and stored are drastically diffrent
// In real enviroment the times would be near identical.
// Currently the query for those inputs are commented off and replaced with a temporary check on the client side
async function searchLRS () {
  const actorEmails = getCheckedValues("actor-dropdown");
  const verbIds = getCheckedValues("verb-dropdown");
  const videoUrls = getCheckedValues("video-dropdown");
  const dateFrom = document.getElementById("date-from").value || null;
  const dateTo = document.getElementById("date-to").value || null;
  const limit = document.getElementById("statement-limit").value;

  console.log(dateFrom, dateTo, limit);

  const params = new URLSearchParams();
  params.append("limit", limit);
  params.append("ascending", "false");

  if (actorEmails.length === 1) params.append("agent", JSON.stringify({ mbox: `mailto:${actorEmails[0]}` }));
  if (verbIds.length === 1) params.append("verb", verbIds[0]);
  if (videoUrls.length === 1) params.append("activity", videoUrls[0]);
  if (dateFrom) params.append("since", new Date(dateFrom + "T00:00:00Z").toISOString());
  if (dateTo) params.append("until", new Date(dateTo + "T23:59:59Z").toISOString());
  
  const response = await fetch(`${LAMBDA_URL}/statements?${params.toString()}&lrs=${getActiveLRS()}`);
  const data = await response.json();
  allStatements = data.statements ?? [];
  console.log("All Statements: ", allStatements);

  if (actorEmails.length > 1) {
    allStatements = allStatements.filter(s =>
      actorEmails.includes(s.actor.mbox?.replace("mailto:", "") ?? "")
    );
  }
  if (verbIds.length > 1) {
    allStatements = allStatements.filter(s =>
      verbIds.some(v => s.verb.id === v)
    );
  }
  if (videoUrls.length > 1) {
    allStatements = allStatements.filter(s =>
      videoUrls.some(v => s.object?.id?.includes(v))
    );
  }

  if (allStatements.length === 0) {
    document.getElementById("raw-display").innerHTML = "No statements found.";
    document.getElementById("summary-display").innerHTML = "No statements found.";
    return;
  }
  
  const activeTab = document.querySelector(".tab-btn.active").dataset.tab;
  if (activeTab === "tab-raw") renderRaw();
  if (activeTab === "tab-table") renderTable();
  if (activeTab === "tab-charts") renderUserCharts();
  if (activeTab === "tab-video") renderVideoCharts();
}

async function fetchRawStatements() {
  console.log("Raw Statement Called");
  try {
    const response = await fetch(`${LAMBDA_URL}/statements?limit=4000&ascending=false&lrs=${getActiveLRS()}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    rawStatements = data.statements ?? [];
    console.log(`Loaded ${rawStatements.length} raw statements for static charts`);
  } catch (err) {
    console.error("Failed to load raw statements:", err);
    rawStatements = [];
  }

  document.getElementById("strict-mode-risk").addEventListener("change", renderAtRisk);
  document.getElementById("strict-mode-completion").addEventListener("change", renderCompletionRate);
}


// -------------------------- CVS Export Functions
// Creates a cvs based on statement
function transformStatement(statment){
  return {
    id: statment.id,
    actor_name: statment.actor?.name,
    actor_mbox: statment.actor?.mbox?.replace("mailto:", ""),
    verb_id: statment.verb?.id,
    context_language: statment.context?.language,
    context_platform: statment.context?.platform,
    timestamp: statment.timestamp,
    stored: statment.stored,
    authority_name: statment.authority?.account?.name,
    authority_homePage: statment.authority?.account?.homePage,
    object_id: statment.object?.id,
    object_name: statment.object?.definition?.name?.["en-US"],
    object_description: statment.object?.definition?.description?.["en-US"],
  };
}

// Converts the JSON of retrieved statements  into a CVS
function jsonToCSV(data) {
  if (!data.length) return "";

  const headers = Array.from(
    new Set(data.flatMap(obj => Object.keys(obj)))
  );

  const rows = data.map(row =>
    headers.map(field => {
      let value = row[field] ?? "";
      value = String(value).replace(/"/g, '""');
      return `"${value}"`;
    }).join(",")
  );

  return [headers.join(","), ...rows].join("\n");
}

// Download CVS
function downloadCSV(csvString, filename = "data.csv") {
  const blob = new Blob([csvString], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = url;
  link.setAttribute("download", filename);
  document.body.appendChild(link);
  link.click();

  document.body.removeChild(link);
}

// Initializes exporting of data into CVS
function exportStatementsToCSV() {
  if (!allStatements || allStatements.length === 0) {
    alert("No data to export");
    return;
  }
  const transformed = allStatements.map(transformStatement);
  const csv = jsonToCSV(transformed);
  downloadCSV(csv, "lrs-export.csv");
}


// --------------------------------------- Authentication -----------------------------------------
// Generate a random string for PKCE
function generateRandom(length = 64) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
  return Array.from(crypto.getRandomValues(new Uint8Array(length)))
    .map(b => chars[b % chars.length]).join("");
}

// Hash the verifier to make the challenge
async function generateCodeChallenge(verifier) {
  const encoded = new TextEncoder().encode(verifier);
  const digest  = await crypto.subtle.digest("SHA-256", encoded);
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

// Start gogole authentification
async function initGoogleAuth() {
  const codeVerifier  = generateRandom();
  const codeChallenge = await generateCodeChallenge(codeVerifier);

  // Store code verifier for future sessions
  sessionStorage.setItem("pkce_verifier", codeVerifier);

  // Generates parameters for login
  const params = new URLSearchParams({
    client_id:             "1057772561162-tgma1vijphnklc8dgbpdaqc7bt0hcbr0.apps.googleusercontent.com",
    redirect_uri:          window.location.origin,
    response_type:         "code",
    scope:                 "openid email profile",
    code_challenge:        codeChallenge,
    code_challenge_method: "S256",
    prompt:                "select_account"
  });
  window.location.href = `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

// Handles google Callback
async function handleGoogleCallback() {
  const params       = new URLSearchParams(window.location.search);
  const code         = params.get("code");
  const codeVerifier = sessionStorage.getItem("pkce_verifier");

  if (!code || !codeVerifier) return;

  // Clean up URL to avoid misuse
  window.history.replaceState({}, document.title, window.location.pathname);
  sessionStorage.removeItem("pkce_verifier");

  try {
    // Attempts login
    const res  = await fetch(`${LAMBDA_URL}/auth/google`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ code, codeVerifier })
    });
    const data = await res.json();

    // Login Failure
    if (!data.success) {
      console.error("Auth failed:", data.error);
      alert(`Login failed: ${data.error}`);
      return;
    }

    // Update frontend based on login
    isLoggedIn  = true;
    currentUser = {
      email:        data.email,
      name:         data.name,
      sessionToken: data.sessionToken
    };
    sessionStorage.setItem("sessionToken", data.sessionToken);
    sessionStorage.setItem("userEmail",    data.email);
    sessionStorage.setItem("userName",     data.name);
    updateAuthUI();
  } catch (err) {
    console.error("Auth error:", err);
  }
}

// Update webpage UI
function updateAuthUI() {
  const btn = document.getElementById("auth-btn");
  if (isLoggedIn) {
    btn.textContent = `Logout (${currentUser.email})`;
  } else {
    btn.textContent = "Login with Google";
  }
}

// Restores previously logged in sessions
function restoreSession() {
  const sessionToken = sessionStorage.getItem("sessionToken");
  const email        = sessionStorage.getItem("userEmail");
  const name         = sessionStorage.getItem("userName");

  if (sessionToken && email) {
    isLoggedIn  = true;
    currentUser = { email, name, sessionToken };
    updateAuthUI();
    console.log("Session restored for:", email);
  }
}

// logs out if logged in
async function logout() {
  const sessionToken = sessionStorage.getItem("sessionToken");

  if (sessionToken) {
    const response = await fetch("YOUR_API_URL/auth/logout", {
      method: "POST",
      headers: { "x-session-token": sessionToken }
    });
  }

  isLoggedIn = false;
  currentUser = null;
  sessionStorage.clear();
  google.accounts.id.cancel();
  google.accounts.id.disableAutoSelect();
  updateAuthUI();
}

// Returns current actor
function getActor() {
  if (currentUser) {
    return {
      objectType: "Agent",
      name:       currentUser.name,
      mbox:       `mailto:${currentUser.email}`
    };
  }

  return ACTOR;
}


// ----------------------------------------------- Salesforce ------------------------------------------------
async function retrieveSalesforceLead() {
  console.log("Retrieving Leads...");
  try {
    const res = await fetch(`${LAMBDA_URL}/salesforce/leads`, {
      method:  "GET",
      headers: {
        "Content-Type": "application/json",
        "x-session-token": currentUser?.sessionToken
      }
    });
    const data = await res.json();
    console.log("Salesforce leads:", data);
    return data.records ?? [];
  } catch (err) {
    console.error("Failed to retrieve Salesforce leads:", err);
    return [];
  }
}

// sends lead to salesforce
async function sendSalesforceLead() {
  console.log("Sending Leads...");
  if (!potentialLeadData || potentialLeadData.length === 0) {
    alert("No data loaded yet. Make sure the charts tab has been viewed.");
    return;
  }

  const highCompletionViewers = potentialLeadData.filter(d => d.rate >= 70);
  console.log("High Completion Users: ", highCompletionViewers);

  if (highCompletionViewers.length === 0) {
    alert("No high-completion viewers found (≥70% completion rate).");
    return;
  }

  try {
    const res = await fetch(`${LAMBDA_URL}/salesforce/leads`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-session-token": currentUser?.sessionToken
      },
      body: JSON.stringify({ potentialLeadData: highCompletionViewers })
    });
    const data = await res.json();
    alert(data.message ?? "Done.");
  } catch (err) {
    console.error("Failed to send leads:", err);
    alert("Error sending leads.");
  }
}
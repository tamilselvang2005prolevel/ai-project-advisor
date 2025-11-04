/* global webllm */
import { SYSTEM_PROMPT, buildUserPrompt } from "./prompts.js";

const els = {
    idea: () => document.getElementById("idea"),
    domain: () => document.getElementById("domain"),
    analyze: () => document.getElementById("analyzeBtn"),
    status: () => document.getElementById("status"),
    results: () => document.getElementById("results"),
    raw: () => document.getElementById("raw"),
    meta: () => document.getElementById("meta"),
    components: () => document.getElementById("components"),
    tools: () => document.getElementById("tools"),
    procedure: () => document.getElementById("procedure"),
    cost: () => document.getElementById("cost"),
    existing: () => document.getElementById("existing"),
    improvements: () => document.getElementById("improvements"),
    time: () => document.getElementById("time"),
    rating: () => document.getElementById("rating"),
    copyJson: () => document.getElementById("copyJson"),
    reset: () => document.getElementById("reset"),
};

let engine = null;
let lastJSON = null;

async function ensureEngine() {
    if (engine) return engine;

    const hasWebGPU = !!navigator.gpu;
    if (!hasWebGPU) {
        throw new Error(
            "This browser lacks WebGPU. Try Chrome/Edge on desktop. (You can also add an API fallback later.)"
        );
    }

    // Load a small-ish model for quick startup. You can switch to a larger one later.
    // See: https://github.com/mlc-ai/web-llm
    const initProgress = (report) => {
        els.status().textContent = `Model: ${report.text}`;
    };

    engine = await webllm.CreateMLCEngine(
        // MLC provides curated models; "Llama-3.1-8B-Instruct-q4f16_1" is a good balance.
        "Llama-3.1-8B-Instruct-q4f16_1-MLC",
        { initProgressCallback: initProgress }
    );
    return engine;
}

function safeParse(jsonText) {
    try {
        return JSON.parse(jsonText);
    } catch {
        // try to salvage JSON (remove leading/trailing text)
        const start = jsonText.indexOf("{");
        const end = jsonText.lastIndexOf("}");
        if (start >= 0 && end >= start) {
            try { return JSON.parse(jsonText.slice(start, end + 1)); } catch { }
        }
        return null;
    }
}

function renderArray(list, el, asOrdered = false) {
    el.innerHTML = "";
    if (!list || !Array.isArray(list)) return;
    if (asOrdered) {
        list.forEach(s => {
            const li = document.createElement("li");
            li.textContent = s;
            el.appendChild(li);
        });
        return;
    }
    list.forEach(item => {
        const li = document.createElement("li");
        if (typeof item === "string") li.textContent = item;
        else if (item && typeof item === "object") {
            const primary = item.name || item.title || item.item || "•";
            const extra = Object.entries(item)
                .filter(([k]) => !["name", "title"].includes(k))
                .map(([k, v]) => `${k}: ${v}`)
                .join(" · ");
            li.textContent = extra ? `${primary} — ${extra}` : primary;
        }
        el.appendChild(li);
    });
}

function renderReport(data) {
    els.results().classList.remove("hidden");

    els.meta().textContent = "Auto-generated plan • Estimates are approximate.";
    renderArray(data.components, els.components());
    renderArray(data.tools, els.tools());
    renderArray(data.procedure, els.procedure(), true);

    const costDiv = els.cost();
    if (data.estimated_cost_usd?.breakdown) {
        const total = data.estimated_cost_usd.total ?? 0;
        costDiv.innerHTML = `
      <ul>
        ${data.estimated_cost_usd.breakdown.map(b => `<li>${b.item}: $${b.cost}</li>`).join("")}
      </ul>
      <strong>Total: $${total}</strong>
    `;
    } else costDiv.textContent = "n/a";

    renderArray(data.existing_projects, els.existing());
    renderArray(data.improvements, els.improvements());
    els.time().textContent = (data.time_days != null) ? `${data.time_days} day(s)` : "n/a";

    const r = data.rating || {};
    els.rating().innerHTML = `<div class="score">Score: <strong>${r.score ?? "?"}/10</strong></div><div class="reason">${r.reason || ""}</div>`;

    els.raw().textContent = JSON.stringify(data, null, 2);
}

async function analyze() {
    const idea = els.idea().value.trim();
    const domain = els.domain().value.trim();
    if (!idea) {
        els.status().textContent = "Please enter a project idea.";
        return;
    }

    if (idea.toLowerCase().includes("test")) {
        const fake = {
            components: [{ name: "ESP32", reason: "Main MCU", approx_price_usd: 5 }],
            tools: [{ name: "Arduino IDE", why: "Simple programming" }],
            procedure: ["Connect sensors", "Write code", "Upload to ESP32"],
            estimated_cost_usd: { breakdown: [{ item: "ESP32 board", cost: 5 }], total: 5 },
            existing_projects: [{ title: "Smart plant monitor", note: "Similar IoT idea" }],
            improvements: ["Add cloud dashboard"],
            time_days: 7,
            rating: { score: 8, reason: "Practical and scalable" }
        };
        renderReport(fake);
        els.status().textContent = "Test data loaded ✅";
        return;
    }


    els.analyze().disabled = true;
    els.status().textContent = "Loading model…";
    try {
        const eng = await ensureEngine();
        els.status().textContent = "Thinking…";

        // Compose chat with system+user
        const messages = [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: buildUserPrompt(idea, domain) }
        ];

        const out = await eng.chat.completions.create({
            messages,
            temperature: 0.3,
            max_tokens: 700
        });

        const rawText = out?.choices?.[0]?.message?.content ?? "";
        const parsed = safeParse(rawText);

        if (!parsed) {
            els.status().textContent = "Could not parse model output. Try again.";
            els.analyze().disabled = false;
            return;
        }
        lastJSON = parsed;
        renderReport(parsed);
        els.status().textContent = "Done.";
    } catch (e) {
        console.error(e);
        els.status().textContent = e.message || "Unexpected error.";
    } finally {
        els.analyze().disabled = false;
    }
}

function copyJSON() {
    if (!lastJSON) return;
    navigator.clipboard.writeText(JSON.stringify(lastJSON, null, 2));
}

function resetUI() {
    els.results().classList.add("hidden");
    els.raw().classList.add("hidden");
    lastJSON = null;
    els.status().textContent = "";
}

document.addEventListener("DOMContentLoaded", () => {
    els.analyze().addEventListener("click", analyze);
    els.copyJson().addEventListener("click", copyJSON);
    els.reset().addEventListener("click", resetUI);
});

// -------------------- Setup & Memory --------------------
const hfKeyInput = document.getElementById("hfKey");
const saveKeyBtn = document.getElementById("saveKeyBtn");
const hfModelSelect = document.getElementById("hfModel");
const chatWindow = document.getElementById("chatWindow");
const sendBtn = document.getElementById("sendBtn");
const userInput = document.getElementById("userInput");
const resetBtn = document.getElementById("resetBtn");
const xpDisplay = document.getElementById("xpDisplay");

let HF_API_KEY = localStorage.getItem("hf_api_key") || "";
hfKeyInput.value = HF_API_KEY;
hfModelSelect.value = localStorage.getItem("hf_model") || "gpt2";

saveKeyBtn.onclick = () => {
  HF_API_KEY = hfKeyInput.value.trim();
  const model = hfModelSelect.value;
  if (!HF_API_KEY) { alert("Paste your Hugging Face API token first."); return; }
  localStorage.setItem("hf_api_key", HF_API_KEY);
  localStorage.setItem("hf_model", model);
  alert("Saved locally. API key stays in your browser only.");
};

// Personality & chat memory stored in localStorage
let personality = JSON.parse(localStorage.getItem("personality")) || {
  tease: 5, bold: 5, charm: 5, confidence: 5, xp: 0
};
let chatHistory = JSON.parse(localStorage.getItem("chatHistory")) || [];

// show XP
xpDisplay.innerText = `XP: ${Math.floor(personality.xp)}`;

// Restore saved chat to UI
function restoreChatUI() {
  chatWindow.innerHTML = "";
  for (const m of chatHistory) {
    addMessage(m.content, m.role === "user" ? "user" : "bot");
  }
}
restoreChatUI();

// -------------------- UI helpers --------------------
function addMessage(text, sender) {
  const d = document.createElement("div");
  d.className = `msg ${sender}`;
  d.textContent = text;
  chatWindow.appendChild(d);
  chatWindow.scrollTop = chatWindow.scrollHeight;
}

// -------------------- Core prompt building --------------------
function buildPrompt(userMessage) {
  // system instruction that guides the model
  const system = `You are "Luca" — a charming, playful, flirtatious but classy assistant.
Never produce explicit sexual content. Keep messages short, confident and smooth.
You learn from the user's prior chats: the user prefers a mix that adapts to the person's tone.

Personality profile (scale 0-10):
tease: ${personality.tease.toFixed(1)}
bold: ${personality.bold.toFixed(1)}
charm: ${personality.charm.toFixed(1)}
confidence: ${personality.confidence.toFixed(1)}

Rules:
- If the user message is a greeting, reply playfully and invite conversation.
- If the user message indicates boredom, propose interactive lines.
- If the user asks for explicit content, refuse politely and steer to flirty lines.
- Keep replies <= 2 short sentences, with 1-2 emojis maximum.
End of instructions.`;

  // compile short chat memory (last N messages) to give context
  const memory = chatHistory.slice(-12).map(m => `${m.role === "user" ? "You" : "Luca"}: ${m.content}`).join("\n");

  const prompt = `${system}\n\nRecent conversation:\n${memory}\n\nUser: ${userMessage}\nLuca:`;
  return prompt;
}

// -------------------- Call Hugging Face Inference API --------------------
async function queryHuggingFace(prompt) {
  const model = hfModelSelect.value || localStorage.getItem("hf_model") || "gpt2";
  // NOTE: Hugging Face inference endpoint:
  // POST https://api-inference.huggingface.co/models/{model}
  // with Authorization: Bearer <token>
  const url = `https://api-inference.huggingface.co/models/${model}`;

  const payload = {
    inputs: prompt,
    parameters: { max_new_tokens: 120, temperature: 0.8, top_p: 0.9 },
    options: { wait_for_model: true }
  };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${HF_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const txt = await res.text();
      console.error("HF error", res.status, txt);
      return "Error: model failed or API key invalid.";
    }

    const data = await res.json();
    // many HF text-gen models return an array of {generated_text: "..." }
    if (Array.isArray(data) && data[0]?.generated_text) {
      // remove the prompt echo if present
      let text = data[0].generated_text;
      // If the model echoes the prompt, try to trim to the last 'Luca:' answer
      const idx = text.lastIndexOf("Luca:");
      if (idx >= 0) text = text.slice(idx + 5).trim();
      return text;
    }

    // fallback: some models return string or other shape
    if (data?.generated_text) return data.generated_text;
    if (typeof data === "string") return data;
    return "Sorry, couldn't parse model reply.";
  } catch (err) {
    console.error(err);
    return "Network or API error.";
  }
}

// -------------------- Analyze & update personality --------------------
function analyzeAndUpdate(userMsg, reply, successSignal = false) {
  // simple heuristics:
  const userLower = userMsg.toLowerCase();
  const positiveIndicators = ["haha","lol","lmao","cute","😘","😍","😊","thanks","ty","amused","haha","love","miss"];
  const negativeIndicators = ["bye","stop","leave","ignore","ok","k"];

  // reward if user used positive indicators OR if reply contained charm/bold triggers
  const pos = positiveIndicators.some(w => userLower.includes(w));
  const neg = negativeIndicators.some(w => userLower === w);

  // XP mechanics
  let deltaXP = pos ? 4 : 1;
  if (neg) deltaXP = -2;

  personality.xp = Math.max(0, (personality.xp || 0) + deltaXP);

  // slowly adjust traits depending on reply length and detected vibe
  // If reply included words like "flirt", "special", etc, boost charm/tease
  const r = reply.toLowerCase();
  if (r.includes("flirt") || r.includes("special") || r.includes("cute")) {
    personality.charm = Math.min(10, personality.charm + 0.25);
    personality.tease = Math.min(10, personality.tease + 0.15);
  }
  // If user reacted positively, increase confidence and bold
  if (pos) {
    personality.confidence = Math.min(10, personality.confidence + 0.4);
    personality.bold = Math.min(10, personality.bold + 0.3);
  }
  // small natural drift (learning)
  personality.tease = Math.min(10, personality.tease + Math.random()*0.12);
  personality.bold = Math.min(10, personality.bold + Math.random()*0.1);
  personality.charm = Math.min(10, personality.charm + Math.random()*0.08);
  personality.confidence = Math.min(10, personality.confidence + Math.random()*0.08);

  // persist
  localStorage.setItem("personality", JSON.stringify(personality));
  xpDisplay.innerText = `XP: ${Math.floor(personality.xp)}`;
}

// -------------------- Main send flow --------------------
async function onSend() {
  const text = userInput.value.trim();
  if (!text) return;
  if (!HF_API_KEY) {
    alert("Paste your Hugging Face API key in the field and press Save Key.");
    return;
  }
  addMessage(text, "user");
  chatHistory.push({ role: "user", content: text });
  userInput.value = "";

  // build prompt with memory
  const prompt = buildPrompt(text);
  addMessage("Luca is typing...", "bot");
  const reply = await queryHuggingFace(prompt);
  // remove 'typing' placeholder
  const nodes = Array.from(chatWindow.querySelectorAll(".bot"));
  for (const n of nodes) {
    if (n.textContent === "Luca is typing...") n.remove();
  }

  addMessage(reply, "bot");
  chatHistory.push({ role: "assistant", content: reply });

  // analyze and update personality & memory
  analyzeAndUpdate(text, reply);
  saveAll();
}

// -------------------- Persistence --------------------
function saveAll() {
  localStorage.setItem("chatHistory", JSON.stringify(chatHistory));
  localStorage.setItem("personality", JSON.stringify(personality));
}

// -------------------- Reset --------------------
resetBtn.onclick = () => {
  if (!confirm("Erase local memory (chat + personality)?")) return;
  localStorage.removeItem("chatHistory");
  localStorage.removeItem("personality");
  chatHistory = [];
  personality = { tease:5, bold:5, charm:5, confidence:5, xp:0 };
  chatWindow.innerHTML = "";
  xpDisplay.innerText = `XP: ${Math.floor(personality.xp)}`;
  alert("Memory cleared.");
}

// -------------------- Event bindings --------------------
sendBtn.onclick = onSend;
userInput.addEventListener("keyup", (e) => { if (e.key === "Enter") onSend(); });

// Save model choice when changed
hfModelSelect.addEventListener("change", () => {
  localStorage.setItem("hf_model", hfModelSelect.value);
});

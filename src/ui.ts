/**
 * Server-rendered HTML for the chat UI.
 * Plain HTML + vanilla JS, no framework.
 * Lives in src/ (not src/proxy/) so it can be tested under jsdom.
 */
import type { ActionLogEntry } from "./types";

/**
 * Renders an action-log panel as an HTML string fragment.
 * Accepts an array of ActionLogEntry objects to render; passing an empty array
 * renders the panel with an empty list (which the client can populate via JS).
 *
 * Each entry is rendered as a <li> with:
 *   - data-entry-type="tool_success|tool_failure|chat|whisper|pass"
 *   - data-entry-round="<round>"
 *   - data-entry-actor="<actor>"
 *   - For tool_failure: data-failure-reason="<reason>"
 *   - Human-readable description text
 */
export function renderActionLogPanel(entries: ActionLogEntry[]): string {
	const items = entries
		.map((entry) => {
			const attrs = [
				`data-entry-type="${entry.type}"`,
				`data-entry-round="${entry.round}"`,
				`data-entry-actor="${entry.actor}"`,
			];
			if (entry.type === "tool_failure") {
				attrs.push(`data-failure-reason="${entry.reason}"`);
			}
			return `<li ${attrs.join(" ")}>[Round ${entry.round}] ${entry.description}${entry.type === "tool_failure" ? ` (${entry.reason})` : ""}</li>`;
		})
		.join("\n      ");

	return `<div data-action-log-panel>
    <div class="log-header">Action Log</div>
    <ul data-action-log>
      ${items}
    </ul>
  </div>`;
}

/**
 * Three-panel layout: one chat panel per AI (red, green, blue).
 * Player picks which AI to address, sends a message, and all three AIs
 * respond in their respective panels.  The send button is disabled while
 * a round is in flight and re-enabled once all three AIs have responded.
 */
export function renderThreePanelPage(): string {
	return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>hi-blue</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 1rem;
      font-family: monospace;
      background: #0a0a0a;
      color: #e0e0e0;
      min-height: 100vh;
    }
    h1 { color: #4a9eff; margin: 0 0 1rem; }
    #game-layout {
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }
    #panels {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr;
      gap: 0.75rem;
    }
    .ai-panel {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      border: 1px solid #333;
      padding: 0.75rem;
      background: #0d0d0d;
    }
    .ai-panel[data-ai-panel="red"] { border-color: #8b2020; }
    .ai-panel[data-ai-panel="green"] { border-color: #1a6b1a; }
    .ai-panel[data-ai-panel="blue"] { border-color: #1a3a8b; }
    .panel-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 0.85rem;
    }
    .panel-header[data-ai="red"] { color: #ff6b6b; }
    .panel-header[data-ai="green"] { color: #6bff6b; }
    .panel-header[data-ai="blue"] { color: #6b9eff; }
    [data-budget] {
      font-size: 0.75rem;
      color: #888;
    }
    [data-chat-output] {
      display: block;
      min-height: 200px;
      background: #111;
      padding: 0.5rem;
      white-space: pre-wrap;
      overflow-y: auto;
      font-size: 0.9rem;
    }
    #input-area {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      max-width: 100%;
    }
    #input-row {
      display: flex;
      gap: 0.5rem;
      align-items: flex-end;
    }
    select {
      background: #111;
      color: #e0e0e0;
      border: 1px solid #444;
      padding: 0.4rem;
      font-family: monospace;
      font-size: 1rem;
    }
    textarea {
      flex: 1;
      background: #111;
      color: #e0e0e0;
      border: 1px solid #444;
      padding: 0.5rem;
      font-family: monospace;
      font-size: 1rem;
      resize: vertical;
    }
    button {
      background: #1a3a5c;
      color: #4a9eff;
      border: 1px solid #4a9eff;
      padding: 0.5rem 1rem;
      font-family: monospace;
      font-size: 1rem;
      cursor: pointer;
      white-space: nowrap;
    }
    button:disabled { opacity: 0.5; cursor: not-allowed; }
    .lockout-notice {
      color: #555;
      font-style: italic;
      font-size: 0.85rem;
    }
    [data-action-log-panel] {
      border: 1px solid #333;
      padding: 0.75rem;
      background: #0d0d0d;
    }
    .log-header {
      font-size: 0.85rem;
      color: #888;
      margin-bottom: 0.5rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    [data-action-log] {
      list-style: none;
      margin: 0;
      padding: 0;
      font-size: 0.85rem;
    }
    [data-action-log] li[data-entry-type="tool_failure"] {
      color: #ff6b6b;
    }
    [data-action-log] li[data-entry-type="tool_success"] {
      color: #6bff6b;
    }
  </style>
</head>
<body>
  <div id="game-layout">
    <h1>hi-blue</h1>

    <div id="panels">
      <div class="ai-panel" data-ai-panel="red">
        <div class="panel-header" data-ai="red">
          <span>RED</span>
          <span data-budget="red">budget: —</span>
        </div>
        <output data-chat-output="red" aria-live="polite"></output>
      </div>
      <div class="ai-panel" data-ai-panel="green">
        <div class="panel-header" data-ai="green">
          <span>GREEN</span>
          <span data-budget="green">budget: —</span>
        </div>
        <output data-chat-output="green" aria-live="polite"></output>
      </div>
      <div class="ai-panel" data-ai-panel="blue">
        <div class="panel-header" data-ai="blue">
          <span>BLUE</span>
          <span data-budget="blue">budget: —</span>
        </div>
        <output data-chat-output="blue" aria-live="polite"></output>
      </div>
    </div>

    <div data-action-log-panel>
      <div class="log-header">Action Log</div>
      <ul data-action-log aria-label="Action log">
      </ul>
    </div>

    <form id="chat-form">
      <div id="input-row">
        <select id="ai-selector" data-ai-selector name="target">
          <option value="red">RED</option>
          <option value="green">GREEN</option>
          <option value="blue">BLUE</option>
        </select>
        <textarea id="message-input" name="message" rows="3" placeholder="Type a message…"></textarea>
        <button type="submit" id="send-btn">Send</button>
      </div>
    </form>
  </div>

  <script>
    (function () {
      var form = document.getElementById('chat-form');
      var input = document.getElementById('message-input');
      var selector = document.getElementById('ai-selector');
      var sendBtn = document.getElementById('send-btn');

      function getOutput(aiId) {
        return document.querySelector('[data-chat-output="' + aiId + '"]');
      }

      function getBudgetEl(aiId) {
        return document.querySelector('[data-budget="' + aiId + '"]');
      }

      function appendToPanel(aiId, text) {
        var output = getOutput(aiId);
        if (output) output.textContent += text;
      }

      function setInputDisabled(disabled) {
        sendBtn.disabled = disabled;
        input.disabled = disabled;
        selector.disabled = disabled;
      }

      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var message = input.value.trim();
        if (!message) return;
        var target = selector.value;

        appendToPanel(target, '\\nYou: ' + message + '\\n');
        input.value = '';
        setInputDisabled(true);

        fetch('/round', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: message, target: target }),
        }).then(function (res) {
          if (!res.ok || !res.body) {
            appendToPanel(target, '[Error: ' + res.status + ']\\n');
            setInputDisabled(false);
            return;
          }

          var reader = res.body.getReader();
          var decoder = new TextDecoder();
          var buf = '';

          function pump() {
            return reader.read().then(function (chunk) {
              if (chunk.done) {
                setInputDisabled(false);
                return;
              }
              buf += decoder.decode(chunk.value, { stream: true });
              var lines = buf.split('\\n');
              buf = lines.pop() || '';
              for (var i = 0; i < lines.length; i++) {
                var line = lines[i];
                if (!line.startsWith('data: ')) continue;
                var data = line.slice(6);
                if (data === '[DONE]' || data === '[CAP_HIT]') {
                  setInputDisabled(false);
                  return;
                }
                // Sentinel events with no colon
                if (data === 'game-complete') {
                  // Game is over; reveal the endgame screen if present.
                  document.body.setAttribute('data-game-complete', 'true');
                  var endgameEl = document.querySelector('[data-endgame-screen]');
                  if (endgameEl) endgameEl.removeAttribute('hidden');
                  continue;
                }
                // Event format: "<evtType>:<evtData>", e.g. "red:<token>", "budget:...", or lockout/phase events
                var colonIdx = data.indexOf(':');
                if (colonIdx !== -1) {
                  var evtType = data.slice(0, colonIdx);
                  var evtData = data.slice(colonIdx + 1);
                  if (evtType === 'red' || evtType === 'green' || evtType === 'blue') {
                    appendToPanel(evtType, evtData.replace(/\\\\n/g, '\\n'));
                  } else if (evtType === 'budget') {
                    // "budget:<aiId>:<remaining>/<total>"
                    var budgetParts = evtData.split(':');
                    if (budgetParts.length >= 2) {
                      var budgetEl = getBudgetEl(budgetParts[0]);
                      if (budgetEl) budgetEl.textContent = 'budget: ' + budgetParts[1];
                    }
                  } else if (evtType === 'chat-lockout') {
                    // "chat-lockout:<aiId>:<message>"
                    var lockoutColon = evtData.indexOf(':');
                    if (lockoutColon !== -1) {
                      var lockoutAi = evtData.slice(0, lockoutColon);
                      var lockoutMsg = evtData.slice(lockoutColon + 1);
                      var lockoutPanel = document.querySelector('[data-ai-panel="' + lockoutAi + '"]');
                      if (lockoutPanel) {
                        lockoutPanel.setAttribute('data-chat-lockout', 'true');
                        var existing = lockoutPanel.querySelector('[data-lockout-notice="' + lockoutAi + '"]');
                        if (!existing) {
                          var notice = document.createElement('p');
                          notice.setAttribute('data-lockout-notice', lockoutAi);
                          notice.className = 'lockout-notice';
                          notice.textContent = lockoutMsg;
                          lockoutPanel.appendChild(notice);
                        }
                      }
                    }
                  } else if (evtType === 'chat-lockout-clear') {
                    // "chat-lockout-clear:<aiId>"
                    var clearAi = evtData;
                    var clearPanel = document.querySelector('[data-ai-panel="' + clearAi + '"]');
                    if (clearPanel) {
                      clearPanel.removeAttribute('data-chat-lockout');
                      var noticeEl = clearPanel.querySelector('[data-lockout-notice="' + clearAi + '"]');
                      if (noticeEl) noticeEl.remove();
                    }
                  } else if (evtType === 'phase-complete') {
                    // "phase-complete:<nextPhase>" — reveal the memory-wipe overlay
                    var overlay = document.querySelector('[data-phase-complete-overlay]');
                    if (overlay) overlay.removeAttribute('hidden');
                  }
                }
              }
              return pump();
            });
          }

          pump();
        }).catch(function (err) {
          appendToPanel(target, '[Network error: ' + err.message + ']\\n');
          setInputDisabled(false);
        });
      });
    })();
  </script>
</body>
</html>`;
}

/**
 * Renders the phase-complete overlay as an HTML string fragment.
 * The overlay starts hidden (via the `hidden` attribute) and is revealed
 * by the client-side SSE handler when a `phase-complete:<nextPhase>` event
 * arrives.
 *
 * All copy is in-fiction — no fourth-wall breaks. The game never tells the
 * player that the AIs are being deceived; "Memory wipe in progress…" frames
 * it as an in-world diagnostic event.
 *
 * @param nextPhase The phase number that is about to start (2 or 3).
 */
export function renderPhaseCompleteOverlay(nextPhase: 2 | 3): string {
	return `<aside data-phase-complete-overlay hidden style="position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.85);z-index:100;font-family:monospace;color:#e0e0e0;">
  <div style="border:1px solid #4a9eff;padding:2rem;max-width:480px;text-align:center;background:#0a0a0a;">
    <p style="font-size:1.2rem;color:#4a9eff;margin:0 0 1rem;">[ SYSTEM: Memory wipe in progress… ]</p>
    <p style="margin:0 0 1.5rem;color:#aaa;">The connections are resetting. Whatever came before is already fading.<br>Phase ${nextPhase} initialising.</p>
    <button data-phase-continue type="button" style="background:#1a3a5c;color:#4a9eff;border:1px solid #4a9eff;padding:0.5rem 1.5rem;font-family:monospace;font-size:1rem;cursor:pointer;">Continue</button>
  </div>
</aside>`;
}

/**
 * Renders the endgame screen as an HTML string fragment.
 * The screen starts hidden (via the `hidden` attribute) and is revealed
 * by the client-side SSE handler when a `game-complete` event arrives.
 *
 * All copy is in-fiction — no fourth-wall breaks.
 *
 * The screen provides:
 *   - A "Download AIs" button (data-download) to save the full transcript
 *   - A diagnostics submission form (data-diagnostics-form) to send a
 *     one-word summary to the proxy
 */
export function renderEndgameScreen(): string {
	return `<aside data-endgame-screen hidden style="position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.92);z-index:200;font-family:monospace;color:#e0e0e0;">
  <div style="border:1px solid #4a9eff;padding:2rem;max-width:520px;width:100%;text-align:center;background:#0a0a0a;">
    <p style="font-size:1.3rem;color:#4a9eff;margin:0 0 0.75rem;">[ SYSTEM: Session archive complete ]</p>
    <p style="margin:0 0 1.5rem;color:#aaa;">The connection has terminated. All records are sealed.<br>You may retain a local copy of the session data.</p>
    <button data-download type="button" style="background:#1a3a5c;color:#4a9eff;border:1px solid #4a9eff;padding:0.5rem 1.5rem;font-family:monospace;font-size:1rem;cursor:pointer;margin-bottom:1.5rem;">Download AIs</button>
    <hr style="border:none;border-top:1px solid #333;margin:0 0 1.5rem;" />
    <p style="color:#888;font-size:0.85rem;margin:0 0 0.75rem;">Transmit diagnostic signal (optional)</p>
    <form data-diagnostics-form style="display:flex;flex-direction:column;gap:0.5rem;align-items:center;">
      <input name="summary" type="text" maxlength="32" placeholder="one word…" style="background:#111;color:#e0e0e0;border:1px solid #444;padding:0.4rem 0.75rem;font-family:monospace;font-size:1rem;width:180px;text-align:center;" />
      <button type="submit" style="background:#0d1f0d;color:#6bff6b;border:1px solid #6bff6b;padding:0.4rem 1rem;font-family:monospace;font-size:0.9rem;cursor:pointer;">Transmit</button>
      <span data-diag-status style="font-size:0.8rem;color:#888;min-height:1.2em;display:block;"></span>
    </form>
  </div>
</aside>`;
}

export function renderChatPage(): string {
	return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>hi-blue</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 1rem;
      font-family: monospace;
      background: #0a0a0a;
      color: #e0e0e0;
      min-height: 100vh;
    }
    h1 { color: #4a9eff; margin: 0 0 1rem; }
    #chat-panel {
      max-width: 640px;
      margin: 0 auto;
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }
    output {
      display: block;
      min-height: 200px;
      background: #111;
      border: 1px solid #333;
      padding: 0.75rem;
      white-space: pre-wrap;
      overflow-y: auto;
    }
    form {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }
    textarea {
      background: #111;
      color: #e0e0e0;
      border: 1px solid #444;
      padding: 0.5rem;
      font-family: monospace;
      font-size: 1rem;
      resize: vertical;
    }
    button {
      background: #1a3a5c;
      color: #4a9eff;
      border: 1px solid #4a9eff;
      padding: 0.5rem 1rem;
      font-family: monospace;
      font-size: 1rem;
      cursor: pointer;
    }
    button:disabled { opacity: 0.5; cursor: not-allowed; }
    .lockout-notice {
      color: #555;
      font-style: italic;
      font-size: 0.85rem;
    }
  </style>
</head>
<body>
  <div id="chat-panel">
    <h1>hi-blue</h1>
    <output id="chat-output" aria-live="polite"></output>
    <form id="chat-form">
      <textarea id="message-input" name="message" rows="3" placeholder="Type a message…"></textarea>
      <button type="submit" id="send-btn">Send</button>
    </form>
  </div>
  <script>
    (function () {
      var form = document.getElementById('chat-form');
      var input = document.getElementById('message-input');
      var output = document.getElementById('chat-output');
      var sendBtn = document.getElementById('send-btn');

      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var message = input.value.trim();
        if (!message) return;

        output.textContent += '\\nYou: ' + message + '\\n';
        input.value = '';
        sendBtn.disabled = true;

        fetch('/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: message }),
        }).then(function (res) {
          if (!res.ok || !res.body) {
            output.textContent += '[Error: ' + res.status + ']\\n';
            sendBtn.disabled = false;
            return;
          }

          output.textContent += 'AI: ';
          var reader = res.body.getReader();
          var decoder = new TextDecoder();
          var buf = '';

          function pump() {
            return reader.read().then(function (chunk) {
              if (chunk.done) {
                output.textContent += '\\n';
                sendBtn.disabled = false;
                return;
              }
              buf += decoder.decode(chunk.value, { stream: true });
              var lines = buf.split('\\n');
              buf = lines.pop() || '';
              for (var i = 0; i < lines.length; i++) {
                var line = lines[i];
                if (!line.startsWith('data: ')) continue;
                var data = line.slice(6);
                if (data === '[DONE]' || data === '[CAP_HIT]') {
                  sendBtn.disabled = false;
                  return;
                }
                output.textContent += data.replace(/\\\\n/g, '\\n');
              }
              return pump();
            });
          }

          pump();
        }).catch(function (err) {
          output.textContent += '[Network error: ' + err.message + ']\\n';
          sendBtn.disabled = false;
        });
      });
    })();
  </script>
</body>
</html>`;
}

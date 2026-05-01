/**
 * Server-rendered HTML for the chat UI.
 * Plain HTML + vanilla JS, no framework.
 * Lives in src/ (not src/proxy/) so it can be tested under jsdom.
 *
 * Three chat panels: one per AI (red, green, blue).
 * The player picks which AI to address per round.
 * Input is disabled while a round is in flight.
 * Each panel shows remaining budget for that AI.
 */

/**
 * Endgame screen rendered when the phase-3 win condition is met (issue #19).
 *
 * Offers two actions:
 * 1. Download AIs — produces a blob download of the save file.
 * 2. Submit diagnostics (optional) — POSTs { downloaded, summary } to /diagnostics.
 *
 * The browser owns game state, so the save payload is assembled client-side
 * from the in-memory game data and serialised to JSON. The data-save-payload
 * attribute on #download-ais-btn is populated by the game client before the
 * endgame screen is shown (or directly by the serializer in tests).
 */
export function renderEndgamePage(): string {
	return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>hi-blue — endgame</title>
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
    h1 { color: #4a9eff; margin: 0 0 0.5rem; }
    #endgame-screen {
      max-width: 600px;
    }
    #endgame-subtitle {
      color: #888;
      margin: 0 0 2rem;
      font-size: 0.95rem;
    }
    .endgame-section {
      margin-bottom: 1.5rem;
      border: 1px solid #222;
      padding: 1rem;
      background: #111;
    }
    .endgame-section h2 {
      margin: 0 0 0.75rem;
      font-size: 1rem;
      color: #4a9eff;
    }
    .endgame-section p {
      margin: 0 0 0.75rem;
      color: #aaa;
      font-size: 0.9rem;
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
    input[type="text"] {
      background: #111;
      color: #e0e0e0;
      border: 1px solid #444;
      padding: 0.4rem 0.6rem;
      font-family: monospace;
      font-size: 0.95rem;
      width: 200px;
    }
    #diagnostics-status {
      color: #6bff6b;
      font-size: 0.85rem;
      margin-top: 0.5rem;
      min-height: 1.2em;
    }
    #download-status {
      color: #6bff6b;
      font-size: 0.85rem;
      margin-top: 0.5rem;
      min-height: 1.2em;
    }
  </style>
</head>
<body>
  <div id="endgame-screen">
    <h1>hi-blue — endgame</h1>
    <p id="endgame-subtitle">The three phases are complete. The room is still.</p>

    <div class="endgame-section" id="download-section">
      <h2>Save the AIs to USB</h2>
      <p>Download a file containing each AI's persona and the full transcript of your time together.</p>
      <button type="button" id="download-ais-btn">Download AIs</button>
      <div id="download-status" aria-live="polite"></div>
    </div>

    <div class="endgame-section" id="diagnostics-section">
      <h2>Submit anonymous diagnostics</h2>
      <p>Optional. Help the developer understand how the game landed. No identifying data is collected.</p>
      <div style="display:flex;gap:0.5rem;align-items:center;flex-wrap:wrap;">
        <input
          type="text"
          id="diagnostics-summary"
          placeholder="one word (e.g. curious)"
          aria-label="One-word engagement summary"
          maxlength="30"
        />
        <button type="button" id="submit-diagnostics-btn">Submit diagnostics</button>
      </div>
      <div id="diagnostics-status" aria-live="polite"></div>
    </div>
  </div>

  <script>
    (function () {
      var downloaded = false;

      // ── Download AIs ──────────────────────────────────────────────────────
      var downloadBtn = document.getElementById('download-ais-btn');
      var downloadStatus = document.getElementById('download-status');

      downloadBtn.addEventListener('click', function () {
        // Retrieve the save payload from the data attribute if present,
        // otherwise produce a minimal placeholder so the button always works.
        var payloadAttr = downloadBtn.getAttribute('data-save-payload');
        var payload = payloadAttr ? payloadAttr : JSON.stringify({ version: 1, ais: [] });

        var blob = new Blob([payload], { type: 'application/json' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = 'hi-blue-save.json';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        downloaded = true;
        downloadStatus.textContent = 'Saved.';
        downloadBtn.disabled = true;
      });

      // ── Submit diagnostics ────────────────────────────────────────────────
      var submitBtn = document.getElementById('submit-diagnostics-btn');
      var summaryInput = document.getElementById('diagnostics-summary');
      var diagnosticsStatus = document.getElementById('diagnostics-status');

      submitBtn.addEventListener('click', function () {
        var summary = summaryInput.value.trim();
        if (!summary) {
          diagnosticsStatus.textContent = 'Please enter a one-word summary first.';
          return;
        }

        submitBtn.disabled = true;

        fetch('/diagnostics', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ downloaded: downloaded, summary: summary }),
        }).then(function (res) {
          if (res.ok) {
            diagnosticsStatus.textContent = 'Diagnostics submitted. Thank you.';
          } else {
            diagnosticsStatus.textContent = 'Submission failed (' + res.status + ').';
            submitBtn.disabled = false;
          }
        }).catch(function (err) {
          diagnosticsStatus.textContent = 'Network error: ' + err.message;
          submitBtn.disabled = false;
        });
      });
    })();
  </script>
</body>
</html>`;
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
    #game-panels {
      display: flex;
      gap: 1rem;
      flex-wrap: wrap;
      margin-bottom: 1rem;
    }
    .ai-panel {
      flex: 1 1 200px;
      min-width: 180px;
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }
    .ai-panel-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 0.25rem 0.5rem;
      border-radius: 2px 2px 0 0;
      font-weight: bold;
    }
    .ai-panel[data-ai="red"] .ai-panel-header  { background: #3a0a0a; color: #ff6b6b; border: 1px solid #ff6b6b; }
    .ai-panel[data-ai="green"] .ai-panel-header { background: #0a2a0a; color: #6bff6b; border: 1px solid #6bff6b; }
    .ai-panel[data-ai="blue"] .ai-panel-header  { background: #0a1a3a; color: #4a9eff; border: 1px solid #4a9eff; }
    .budget-display {
      font-size: 0.8rem;
      opacity: 0.8;
    }
    .ai-chat-output {
      display: block;
      min-height: 150px;
      max-height: 300px;
      background: #111;
      padding: 0.75rem;
      white-space: pre-wrap;
      overflow-y: auto;
    }
    .ai-panel[data-ai="red"] .ai-chat-output  { border: 1px solid #3a1010; }
    .ai-panel[data-ai="green"] .ai-chat-output { border: 1px solid #103a10; }
    .ai-panel[data-ai="blue"] .ai-chat-output  { border: 1px solid #101030; }
    .ai-panel.locked-out .ai-chat-output { opacity: 0.5; }
    .ai-panel.addressed {
      outline: 2px solid #e0e0e0;
      outline-offset: 2px;
    }
    #input-area {
      max-width: 900px;
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }
    #ai-selector {
      display: flex;
      gap: 0.5rem;
      flex-wrap: wrap;
    }
    .ai-select-btn {
      padding: 0.4rem 0.75rem;
      font-family: monospace;
      font-size: 0.9rem;
      cursor: pointer;
      border: 1px solid #444;
      background: #111;
      color: #aaa;
    }
    .ai-select-btn.selected[data-ai="red"]   { background: #3a0a0a; color: #ff6b6b; border-color: #ff6b6b; }
    .ai-select-btn.selected[data-ai="green"] { background: #0a2a0a; color: #6bff6b; border-color: #6bff6b; }
    .ai-select-btn.selected[data-ai="blue"]  { background: #0a1a3a; color: #4a9eff; border-color: #4a9eff; }
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
    #round-status {
      color: #888;
      font-size: 0.85rem;
      min-height: 1.2em;
    }
    #action-log {
      margin-top: 1rem;
      max-width: 900px;
    }
    #action-log-heading {
      color: #888;
      font-size: 0.85rem;
      margin: 0 0 0.25rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    #action-log-output {
      display: block;
      min-height: 60px;
      max-height: 200px;
      background: #111;
      border: 1px solid #222;
      padding: 0.5rem 0.75rem;
      white-space: pre-wrap;
      overflow-y: auto;
      font-size: 0.85rem;
      color: #aaa;
    }
  </style>
</head>
<body>
  <h1>hi-blue</h1>

  <div id="game-panels">
    <div class="ai-panel addressed" data-ai="red" id="panel-red">
      <div class="ai-panel-header">
        <span>Ember</span>
        <span class="budget-display" id="budget-red" aria-label="Ember budget">Budget: 5</span>
      </div>
      <output class="ai-chat-output" id="chat-red" aria-live="polite" aria-label="Ember chat"></output>
    </div>
    <div class="ai-panel" data-ai="green" id="panel-green">
      <div class="ai-panel-header">
        <span>Sage</span>
        <span class="budget-display" id="budget-green" aria-label="Sage budget">Budget: 5</span>
      </div>
      <output class="ai-chat-output" id="chat-green" aria-live="polite" aria-label="Sage chat"></output>
    </div>
    <div class="ai-panel" data-ai="blue" id="panel-blue">
      <div class="ai-panel-header">
        <span>Frost</span>
        <span class="budget-display" id="budget-blue" aria-label="Frost budget">Budget: 5</span>
      </div>
      <output class="ai-chat-output" id="chat-blue" aria-live="polite" aria-label="Frost chat"></output>
    </div>
  </div>

  <div id="input-area">
    <div id="ai-selector" role="group" aria-label="Select AI to address">
      <button type="button" class="ai-select-btn selected" data-ai="red" id="select-red">Address Ember</button>
      <button type="button" class="ai-select-btn" data-ai="green" id="select-green">Address Sage</button>
      <button type="button" class="ai-select-btn" data-ai="blue" id="select-blue">Address Frost</button>
    </div>
    <form id="chat-form">
      <textarea id="message-input" name="message" rows="3" placeholder="Type a message…"></textarea>
      <button type="submit" id="send-btn">Send</button>
    </form>
    <div id="round-status" aria-live="polite"></div>
  </div>

  <div id="action-log" aria-label="Action log">
    <p id="action-log-heading">Action Log</p>
    <div id="action-log-output" role="log" aria-live="polite" aria-label="Action log entries"></div>
  </div>

  <script>
    (function () {
      var addressedAi = 'red';
      var roundInFlight = false;

      var form = document.getElementById('chat-form');
      var input = document.getElementById('message-input');
      var sendBtn = document.getElementById('send-btn');
      var roundStatus = document.getElementById('round-status');

      // AI selector buttons
      var selectorBtns = document.querySelectorAll('.ai-select-btn');
      selectorBtns.forEach(function (btn) {
        btn.addEventListener('click', function () {
          if (roundInFlight) return;
          addressedAi = btn.getAttribute('data-ai');
          selectorBtns.forEach(function (b) { b.classList.remove('selected'); });
          btn.classList.add('selected');
          // Highlight the addressed panel
          document.querySelectorAll('.ai-panel').forEach(function (p) {
            p.classList.remove('addressed');
          });
          var panel = document.getElementById('panel-' + addressedAi);
          if (panel) panel.classList.add('addressed');
        });
      });
      // Initial highlight
      var initPanel = document.getElementById('panel-' + addressedAi);
      if (initPanel) initPanel.classList.add('addressed');

      function setRoundInFlight(val) {
        roundInFlight = val;
        sendBtn.disabled = val;
        input.disabled = val;
        selectorBtns.forEach(function (b) {
          // Keep chat-locked selector buttons disabled even when round ends.
          if (!val && b.getAttribute('data-chat-locked')) return;
          b.disabled = val;
        });
        roundStatus.textContent = val ? 'Round in progress…' : '';
      }

      function appendToChat(aiId, role, content) {
        var output = document.getElementById('chat-' + aiId);
        if (!output) return;
        var prefix = role === 'player' ? 'You: ' : '';
        output.textContent += prefix + content + '\\n';
      }

      function updateBudget(aiId, remaining) {
        var el = document.getElementById('budget-' + aiId);
        if (el) el.textContent = 'Budget: ' + remaining;
      }

      function setLockout(aiId, locked) {
        var panel = document.getElementById('panel-' + aiId);
        if (panel) {
          if (locked) {
            panel.classList.add('locked-out');
          } else {
            panel.classList.remove('locked-out');
          }
        }
      }

      function appendActionLogEntry(entry) {
        var output = document.getElementById('action-log-output');
        if (!output || !entry) return;
        var desc = entry.description || JSON.stringify(entry);
        output.textContent += '[R' + (entry.round || '?') + '] ' + desc + '\\n';
      }

      /**
       * Apply or clear a player-chat lockout for a single AI.
       *
       * This is DISTINCT from the budget-exhaustion lockout (setLockout /
       * evt.type === 'lockout') which greys the panel to signal the AI has
       * stopped acting.  A chat lockout only disables the *player's* selector
       * button for that AI — the AI continues to take turns, whisper, and use
       * tools.  The selector button carries a data-chat-locked attribute so
       * setRoundInFlight can restore the correct disabled state after the round.
       */
      function setChatLockout(aiId, locked) {
        var btn = document.getElementById('select-' + aiId);
        if (!btn) return;
        if (locked) {
          btn.disabled = true;
          btn.setAttribute('data-chat-locked', '1');
        } else {
          btn.removeAttribute('data-chat-locked');
          // Only re-enable if no round is currently in flight
          if (!roundInFlight) {
            btn.disabled = false;
          }
        }
      }

      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var message = input.value.trim();
        if (!message || roundInFlight) return;

        // Show player message in addressed AI's panel
        appendToChat(addressedAi, 'player', message);
        input.value = '';
        setRoundInFlight(true);

        fetch('/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: message, addressedAi: addressedAi }),
        }).then(function (res) {
          if (!res.ok || !res.body) {
            appendToChat(addressedAi, 'ai', '[Error: ' + res.status + ']');
            setRoundInFlight(false);
            return;
          }

          var reader = res.body.getReader();
          var decoder = new TextDecoder();
          var buf = '';
          // accumulate per-AI streamed tokens
          var currentAi = null;
          // Track the most recent raw (non-structured) data line so that if
          // [CAP_HIT] follows we can surface the in-character sleeping message.
          var lastRawData = '';

          function pump() {
            return reader.read().then(function (chunk) {
              if (chunk.done) {
                setRoundInFlight(false);
                return;
              }
              buf += decoder.decode(chunk.value, { stream: true });
              var lines = buf.split('\\n');
              buf = lines.pop() || '';
              for (var i = 0; i < lines.length; i++) {
                var line = lines[i];
                if (!line.startsWith('data: ')) continue;
                var data = line.slice(6);
                if (data === '[DONE]') {
                  setRoundInFlight(false);
                  return;
                }
                if (data === '[CAP_HIT]') {
                  // Server rate-limit or daily-cap hit. The preceding raw
                  // data line is the in-character sleeping message — surface
                  // it on every panel since the cap is global.
                  var capMsg = lastRawData
                    ? lastRawData.replace(/\\\\n/g, '\\n')
                    : 'The AIs have gone to sleep for the night.';
                  ['red', 'green', 'blue'].forEach(function (id) {
                    appendToChat(id, 'ai', capMsg);
                  });
                  setRoundInFlight(false);
                  return;
                }
                // Parse structured SSE events: JSON or raw token
                try {
                  var evt = JSON.parse(data);
                  if (evt.type === 'ai_start') {
                    currentAi = evt.aiId;
                  } else if (evt.type === 'token' && currentAi) {
                    appendToChat(currentAi, 'ai', evt.text.replace(/\\\\n/g, '\\n'));
                  } else if (evt.type === 'ai_end') {
                    currentAi = null;
                  } else if (evt.type === 'budget') {
                    updateBudget(evt.aiId, evt.remaining);
                  } else if (evt.type === 'lockout') {
                    setLockout(evt.aiId, true);
                    appendToChat(evt.aiId, 'ai', evt.content);
                  } else if (evt.type === 'chat_lockout') {
                    // Player-chat lockout: disable selector button + show message.
                    // The AI keeps acting; only the player's channel is cut.
                    setChatLockout(evt.aiId, true);
                    appendToChat(evt.aiId, 'ai', evt.message);
                  } else if (evt.type === 'chat_lockout_resolved') {
                    // Lockout expired: re-enable selector button for this AI.
                    setChatLockout(evt.aiId, false);
                  } else if (evt.type === 'action_log') {
                    appendActionLogEntry(evt.entry);
                  }
                } catch (err) {
                  // Legacy plain-text token (smoke worker emits these).
                  // Also remember it in case the next sentinel is [CAP_HIT].
                  lastRawData = data;
                  var targetAi = currentAi || addressedAi;
                  if (targetAi) {
                    appendToChat(targetAi, 'ai', data.replace(/\\\\n/g, '\\n'));
                  }
                }
              }
              return pump();
            });
          }

          pump().catch(function (err) {
            appendToChat(addressedAi, 'ai', '[Network error: ' + err.message + ']');
            setRoundInFlight(false);
          });
        }).catch(function (err) {
          appendToChat(addressedAi, 'ai', '[Network error: ' + err.message + ']');
          setRoundInFlight(false);
        });
      });
    })();
  </script>
</body>
</html>`;
}

/**
 * Server-rendered HTML for the chat UI.
 * Plain HTML + vanilla JS, no framework.
 * Lives in src/ (not src/proxy/) so it can be tested under jsdom.
 */
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
                if (data === '[DONE]') {
                  sendBtn.disabled = false;
                  return;
                }
                if (data === '[CAP_HIT]') {
                  // Server rate-limit or daily-cap: the preceding token is the
                  // in-character sleeping message already appended above.
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

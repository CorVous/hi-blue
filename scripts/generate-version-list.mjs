import { execSync } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

async function generateVersionList() {
	try {
		// Get all v* tags sorted by version (highest first)
		const tagsOutput = execSync("git tag --list 'v*' | sort -V | tac", {
			cwd: root,
			encoding: "utf8",
		}).trim();

		const tags = tagsOutput ? tagsOutput.split("\n") : [];

		// Build metadata for each version
		const versions = tags
			.map((tag) => {
				try {
					// Get the commit date
					const dateStr = execSync(`git log -1 --format=%ci "${tag}"`, {
						cwd: root,
						encoding: "utf8",
					}).trim();
					const date = new Date(dateStr);
					const isBeta = tag.includes("-beta");

					return {
						tag,
						version: tag.slice(1), // Remove 'v' prefix
						date,
						dateFormatted: date.toLocaleDateString("en-US", {
							year: "numeric",
							month: "short",
							day: "numeric",
						}),
						isBeta,
					};
				} catch {
					return null;
				}
			})
			.filter((v) => v !== null);

		// Generate HTML
		const html = `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>hi-blue Versions</title>
	<style>
		* {
			margin: 0;
			padding: 0;
			box-sizing: border-box;
		}
		body {
			font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
			background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
			min-height: 100vh;
			display: flex;
			align-items: center;
			justify-content: center;
			padding: 20px;
		}
		.container {
			background: white;
			border-radius: 12px;
			box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
			max-width: 600px;
			width: 100%;
			padding: 40px;
		}
		h1 {
			font-size: 28px;
			margin-bottom: 30px;
			color: #333;
			text-align: center;
		}
		.version-list {
			display: flex;
			flex-direction: column;
			gap: 12px;
		}
		.version-item {
			display: flex;
			align-items: center;
			justify-content: space-between;
			padding: 16px;
			border: 1px solid #e5e7eb;
			border-radius: 8px;
			transition: all 0.2s ease;
			text-decoration: none;
			color: inherit;
			cursor: pointer;
		}
		.version-item:hover {
			background: #f9fafb;
			border-color: #667eea;
			box-shadow: 0 4px 12px rgba(102, 126, 234, 0.1);
		}
		.version-info {
			flex: 1;
		}
		.version-number {
			font-size: 16px;
			font-weight: 600;
			color: #1f2937;
			margin-bottom: 4px;
		}
		.version-date {
			font-size: 13px;
			color: #6b7280;
		}
		.beta-badge {
			display: inline-block;
			background: #fef3c7;
			color: #92400e;
			padding: 2px 8px;
			border-radius: 4px;
			font-size: 11px;
			font-weight: 600;
			margin-left: 8px;
			text-transform: uppercase;
		}
		.arrow {
			color: #d1d5db;
			font-size: 18px;
			margin-left: 16px;
		}
		.empty {
			text-align: center;
			color: #6b7280;
			padding: 40px 20px;
		}
		.footer {
			margin-top: 30px;
			padding-top: 30px;
			border-top: 1px solid #e5e7eb;
			text-align: center;
			color: #6b7280;
			font-size: 13px;
		}
		.footer a {
			color: #667eea;
			text-decoration: none;
		}
		.footer a:hover {
			text-decoration: underline;
		}
	</style>
</head>
<body>
	<div class="container">
		<h1>hi-blue Versions</h1>
		${
			versions.length > 0
				? `<div class="version-list">
			${versions
				.map(
					(v) => `
				<a href="/hi-blue/v/${v.version}/" class="version-item">
					<div class="version-info">
						<div class="version-number">
							${v.version}${v.isBeta ? '<span class="beta-badge">Beta</span>' : ""}
						</div>
						<div class="version-date">Released ${v.dateFormatted}</div>
					</div>
					<div class="arrow">→</div>
				</a>
			`,
				)
				.join("")}
		</div>`
				: '<div class="empty">No releases yet. Check back soon!</div>'
		}
		<div class="footer">
			<p><a href="/hi-blue/nightly/">View latest nightly build</a></p>
		</div>
	</div>
</body>
</html>`;

		// Ensure v/ directory exists
		const vDir = path.join(root, "dist", "v");
		await fs.mkdir(vDir, { recursive: true });

		// Write the version list page
		await fs.writeFile(path.join(vDir, "index.html"), html);
		console.log(`Generated version list with ${versions.length} version(s)`);
	} catch (error) {
		console.error("Failed to generate version list:", error.message);
		// Don't fail the build if version list generation fails
	}
}

await generateVersionList();

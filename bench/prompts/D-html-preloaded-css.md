Write the body of a web page in plain HTML. A fixed stylesheet is already loaded, so do not write a <style> element, a style sheet link, a <head>, a <html> or a <body> tag, or a doctype; write only the markup that goes inside the page. The stylesheet handles light and dark mode and phone widths. Use no JavaScript and no external resources of any kind (no CDN files, web fonts or remote images). Use the classes below; inline style attributes are allowed only where this list says so. Escape &, < and > in text.

<preloaded-classes>
Page and text
- Wrap everything in <main class="page">...</main>. Add class "wide" (class="page wide") when the page has wide tables or diagrams.
- <h1> is the page title, once. <p class="sub"> directly under it is a one-line subtitle or byline. <h2> opens a section, <h3> a sub-section. Plain <p>, <ul>, <ol>, <a>, <code>, <pre> are styled. <p class="muted"> is small grey text (sources, notes).

Headline numbers
- <div class="kpis"> holds tiles: <div class="kpi"><span class="kpi-label">Deploys</span><span class="kpi-value">47</span><span class="kpi-note">vs 41 last week</span></div>. kpi-note is optional. Put class "up" or "down" on kpi-note for a good or bad change.

Tables
- <div class="tablewrap"><table class="data"><thead><tr><th>Name</th><th class="num">Count</th></tr></thead><tbody><tr><td>Row</td><td class="num">12</td></tr></tbody></table></div>. Use class "num" on th and td in numeric columns (right-aligned).

Callouts and tags
- <div class="callout"><p>A note.</p></div>; class "callout warn" for a warning; class "callout crit" for a critical alert.
- <span class="tag">label</span>, or "tag ok", "tag warn", "tag crit" for a status.

Side-by-side items
- <div class="grid cols-2"> or <div class="grid cols-3"> holds <div class="card"><h3>Option A</h3><p>...</p></div> items; the columns stack on a phone.

Bar chart (CSS only, for comparing a few values)
- <div class="bars"><div class="bar"><span>Label</span><i style="--v:62"></i><b>62%</b></div>...</div>. The only allowed style is --v, a number from 0 to 100: the bar length as a percent of the largest value, so scale it yourself: v = 100 x value / largest value.

Steps and timelines
- <ol class="steps"><li><strong>Step title</strong> detail text</li>...</ol> shows numbered steps joined by a line.

Diagrams and line charts
- Draw these yourself as inline SVG inside <div class="diagram"><svg viewBox="0 0 W H">...</svg></div>. Always give the svg a viewBox and no fixed width. SVG classes: "dg-node" on a <rect> (box), "dg-group" on a <rect> drawn around a group, "dg-edge" on a <path> or <line> (add marker-end for arrowheads), "dg-text" on node <text>, "dg-label" on edge labels and axis labels. A line chart is a <polyline class="dg-edge"> on labelled axes. Make charts accurate to the data and diagrams readable, with no overlapping labels.
</preloaded-classes>

Example of the markup (a fragment; yours covers the whole brief):
<main class="page wide">
<h1>Platform weekly status</h1>
<p class="sub">Week ending 2026-10-16</p>
<div class="kpis"><div class="kpi"><span class="kpi-label">Deploys</span><span class="kpi-value">47</span><span class="kpi-note up">+6 vs last week</span></div><div class="kpi"><span class="kpi-label">Open incidents</span><span class="kpi-value">2</span></div></div>
<h2>Highlights</h2>
<ul><li>Postgres 16 upgrade finished on all 14 clusters.</li></ul>
<div class="callout warn"><p><strong>Watch:</strong> the build cache is near its size limit.</p></div>
<h2>Cost by team</h2>
<div class="bars"><div class="bar"><span>Checkout</span><i style="--v:100"></i><b>$41k</b></div><div class="bar"><span>Search</span><i style="--v:63"></i><b>$26k</b></div></div>
<div class="tablewrap"><table class="data"><thead><tr><th>Team</th><th class="num">Spend</th></tr></thead><tbody><tr><td>Checkout</td><td class="num">$41,000</td></tr><tr><td>Search</td><td class="num">$26,000</td></tr></tbody></table></div>
<h2>Rollout</h2>
<ol class="steps"><li><strong>Mon 12 Oct</strong> Canary on 5% of traffic.</li><li><strong>Wed 14 Oct</strong> Full rollout.</li></ol>
<h2>Request path</h2>
<div class="diagram"><svg viewBox="0 0 460 90"><rect class="dg-node" x="10" y="25" width="120" height="40" rx="6"/><text class="dg-text" x="70" y="50" text-anchor="middle">Client</text><path class="dg-edge" d="M130 45H210" marker-end="url(#a)"/><text class="dg-label" x="170" y="38" text-anchor="middle">HTTPS</text><rect class="dg-node" x="210" y="25" width="120" height="40" rx="6"/><text class="dg-text" x="270" y="50" text-anchor="middle">API</text><defs><marker id="a" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0 0L8 4L0 8z" fill="currentColor"/></marker></defs></svg></div>
</main>

Write the body markup once. Make the page read as a finished, designed page: lead with the headline numbers if the brief has any, use tables for rows of data, charts for series, and cards or steps where the content is parallel or ordered.

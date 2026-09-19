/**
 * One stylesheet for both admin pages. Colours are declared once as tokens on
 * :root so the dark scheme only has to restate the tokens.
 */
export const baseStyles = `
  :root {
    color-scheme: light dark;
    --bg: #f5f3ee;
    --surface: #ffffff;
    --surface-2: #fbfaf6;
    --surface-3: #f0eee7;
    --border: #e3ded3;
    --border-strong: #cec7b8;
    --text: #18211f;
    --text-muted: #5f675f;
    --text-soft: #868d83;
    --accent: #18342f;
    --accent-text: #ffffff;
    --accent-soft: #e6efe9;
    --link: #0d5b6d;
    --good-bg: #dcecda;
    --good-text: #1d5228;
    --good-border: #b3cfb0;
    --warn-bg: #fdefc0;
    --warn-text: #6a4b00;
    --warn-border: #e3cd7e;
    --bad-bg: #fbdcd6;
    --bad-text: #8a2313;
    --bad-border: #e8b4a8;
    --info-bg: #dfeaee;
    --info-text: #1d4d5b;
    --info-border: #b3ccd4;
    --shadow: 0 1px 2px rgba(20, 30, 25, .05);
    --radius: 10px;
    font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    color: var(--text);
    background: var(--bg);
  }

  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #14181a;
      --surface: #1c2124;
      --surface-2: #22282b;
      --surface-3: #272e31;
      --border: #313a3e;
      --border-strong: #45524f;
      --text: #e9ede9;
      --text-muted: #a4ada5;
      --text-soft: #8b948c;
      --accent: #4c9a83;
      --accent-text: #08110e;
      --accent-soft: #24352f;
      --link: #7ec8dc;
      --good-bg: #1e3a26;
      --good-text: #a8dfae;
      --good-border: #2f5c3a;
      --warn-bg: #3d3413;
      --warn-text: #f0d489;
      --warn-border: #6b5a21;
      --bad-bg: #43211a;
      --bad-text: #f3b3a4;
      --bad-border: #74362a;
      --info-bg: #1b3238;
      --info-text: #a6d4e0;
      --info-border: #2f5259;
      --shadow: 0 1px 2px rgba(0, 0, 0, .3);
    }
  }

  * { box-sizing: border-box; }
  [hidden] { display: none !important; }
  body { margin: 0; background: var(--bg); color: var(--text); }
  h1, h2, h3, h4 { margin: 0; letter-spacing: 0; }
  h1 { font-size: 22px; line-height: 1.2; }
  h2 { font-size: 17px; line-height: 1.25; }
  h3 { font-size: 15px; line-height: 1.3; }
  p { margin: 0; }
  a { color: var(--link); text-decoration-thickness: 1px; text-underline-offset: 3px; }
  a:hover { text-decoration-thickness: 2px; }
  :focus-visible { outline: 2px solid var(--link); outline-offset: 2px; border-radius: 4px; }

  .muted { color: var(--text-muted); }
  .soft { color: var(--text-soft); }
  .sr-only {
    position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
    overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0;
  }

  button {
    font: inherit; font-size: 13px; cursor: pointer; color: var(--text);
    background: var(--surface); border: 1px solid var(--border-strong);
    border-radius: 8px; padding: 7px 11px; min-height: 34px;
  }
  button:hover { background: var(--surface-3); }
  button.primary { background: var(--accent); border-color: var(--accent); color: var(--accent-text); font-weight: 650; }
  button.primary:hover { filter: brightness(1.08); }
  button.done, button.done:hover { background: var(--good-bg); border-color: var(--good-border); color: var(--good-text); }

  .btnlink {
    display: inline-flex; align-items: center; min-height: 34px; padding: 7px 11px;
    border: 1px solid var(--border-strong); border-radius: 8px; background: var(--surface);
    color: var(--text); font-size: 13px; text-decoration: none;
  }
  .btnlink:hover { background: var(--surface-3); text-decoration: none; }

  .status {
    display: inline-flex; align-items: center; gap: 6px; min-height: 24px;
    padding: 3px 10px; border-radius: 999px; font-size: 12px; font-weight: 650;
    border: 1px solid transparent; white-space: nowrap;
  }
  .status::before { content: ""; width: 7px; height: 7px; border-radius: 50%; background: currentColor; }
  .status-healthy { background: var(--good-bg); color: var(--good-text); border-color: var(--good-border); }
  .status-warning { background: var(--warn-bg); color: var(--warn-text); border-color: var(--warn-border); }
  .status-failing { background: var(--bad-bg); color: var(--bad-text); border-color: var(--bad-border); }
`;

export const dashboardStyles = `
  .appbar {
    position: sticky; top: 0; z-index: 20; background: var(--surface);
    border-bottom: 1px solid var(--border);
  }
  .appbar-inner {
    max-width: 1180px; margin: 0 auto; padding: 14px clamp(16px, 4vw, 32px) 0;
    display: grid; gap: 10px;
  }
  .brandrow { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
  .brand { display: flex; align-items: baseline; gap: 10px; margin-right: auto; }
  .brand .mode {
    font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .06em;
    color: var(--text-soft); border: 1px solid var(--border); border-radius: 999px; padding: 2px 8px;
  }
  .brandrow .toolbar { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .metaline {
    display: flex; gap: 8px 14px; align-items: center; flex-wrap: wrap;
    font-size: 13px; color: var(--text-muted);
  }

  .tabs { display: flex; gap: 4px; overflow-x: auto; scrollbar-width: none; }
  .tabs::-webkit-scrollbar { display: none; }
  .tab {
    appearance: none; background: none; border: 0; border-bottom: 2px solid transparent;
    border-radius: 0; padding: 9px 12px 10px; min-height: 40px; white-space: nowrap;
    color: var(--text-muted); font-size: 14px; font-weight: 600;
    display: inline-flex; align-items: center; gap: 7px;
  }
  .tab:hover { background: none; color: var(--text); }
  .tab[aria-selected="true"] { color: var(--text); border-bottom-color: var(--accent); }
  .tab .badge {
    display: inline-flex; align-items: center; justify-content: center; min-width: 20px; height: 19px;
    padding: 0 6px; border-radius: 999px; font-size: 11px; font-weight: 700;
    background: var(--surface-3); color: var(--text-muted);
  }
  .tab[aria-selected="true"] .badge { background: var(--accent); color: var(--accent-text); }
  .tab .badge.alert { background: var(--warn-bg); color: var(--warn-text); }

  main { max-width: 1180px; margin: 0 auto; padding: 22px clamp(16px, 4vw, 32px) 64px; }
  .tabpanel { display: grid; gap: 26px; }

  .section { display: grid; gap: 12px; }
  .section-head { display: grid; gap: 3px; }
  .section-head .titlerow { display: flex; align-items: baseline; gap: 9px; flex-wrap: wrap; }
  .section-head .hint { font-size: 13px; color: var(--text-muted); line-height: 1.45; max-width: 74ch; }
  .count-chip {
    display: inline-flex; align-items: center; justify-content: center; min-width: 22px; height: 20px;
    padding: 0 7px; border-radius: 999px; background: var(--surface-3); color: var(--text-muted);
    font-size: 11px; font-weight: 700;
  }

  .panel { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); box-shadow: var(--shadow); }
  .panel.pad { padding: 16px; }

  .banner { border-radius: var(--radius); padding: 12px 14px; font-size: 14px; line-height: 1.45; border: 1px solid; }
  .banner-warning { background: var(--warn-bg); color: var(--warn-text); border-color: var(--warn-border); }
  .banner-info { background: var(--info-bg); color: var(--info-text); border-color: var(--info-border); }

  .empty {
    background: var(--surface); border: 1px dashed var(--border-strong); border-radius: var(--radius);
    padding: 20px; display: grid; gap: 8px; justify-items: start; color: var(--text-muted);
    font-size: 14px; line-height: 1.5;
  }
  .empty strong { color: var(--text); font-size: 15px; }

  .contextbar {
    display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between;
    gap: 8px 20px; padding: 12px 16px; font-size: 13.5px;
  }
  .contextbar .flow { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 9px; color: var(--text-muted); }
  .contextbar .flow b { font-size: 17px; font-weight: 750; color: var(--text); margin-right: 3px; }
  .contextbar .flow .arrow { color: var(--border-strong); }
  .contextbar .flow .final b { color: var(--accent); }
  @media (prefers-color-scheme: dark) { .contextbar .flow .final b { color: var(--link); } }
  .contextbar .ctx-facts { display: flex; flex-wrap: wrap; gap: 4px 14px; color: var(--text-muted); }
  .contextbar button { font-size: 12.5px; padding: 5px 9px; min-height: 30px; }

  .segmented { display: flex; gap: 6px; flex-wrap: wrap; }
  .seg {
    display: inline-flex; align-items: center; gap: 7px; border-radius: 999px; padding: 7px 14px;
    background: var(--surface); border: 1px solid var(--border-strong); font-size: 13px; font-weight: 600;
  }
  .seg[aria-pressed="true"] { background: var(--accent); border-color: var(--accent); color: var(--accent-text); }
  .seg[aria-pressed="true"]:hover { background: var(--accent); filter: brightness(1.08); }
  .seg .badge {
    display: inline-flex; align-items: center; justify-content: center; min-width: 19px; height: 18px;
    padding: 0 6px; border-radius: 999px; font-size: 11px; font-weight: 700;
    background: var(--surface-3); color: var(--text-muted);
  }
  .seg[aria-pressed="true"] .badge { background: rgba(255, 255, 255, .22); color: var(--accent-text); }

  .cards { display: grid; gap: 14px; grid-template-columns: repeat(auto-fill, minmax(360px, 1fr)); align-items: start; }
  .eventcard { display: grid; gap: 12px; padding: 16px; }
  .eventcard-head { display: flex; gap: 12px; align-items: flex-start; justify-content: space-between; }
  .eventcard-head h3 { line-height: 1.3; }
  .eventcard-when { margin-top: 5px; font-size: 13px; color: var(--text-muted); line-height: 1.5; }
  .eventcard-when b { font-weight: 600; color: var(--text); }

  .scorebadge {
    flex: 0 0 auto; display: grid; justify-items: center; gap: 1px; min-width: 58px;
    padding: 7px 9px; border-radius: 9px; border: 1px solid;
  }
  .scorebadge b { font-size: 20px; line-height: 1.05; font-weight: 750; }
  .scorebadge span { font-size: 10px; font-weight: 650; opacity: .8; }
  .score-strong { background: var(--good-bg); color: var(--good-text); border-color: var(--good-border); }
  .score-pass { background: var(--info-bg); color: var(--info-text); border-color: var(--info-border); }
  .score-near { background: var(--warn-bg); color: var(--warn-text); border-color: var(--warn-border); }
  .score-low { background: var(--surface-3); color: var(--text-muted); border-color: var(--border); }

  .taglist { display: flex; gap: 6px; flex-wrap: wrap; }
  .tag {
    display: inline-flex; align-items: center; min-height: 22px; padding: 2px 9px; border-radius: 999px;
    font-size: 12px; font-weight: 620; background: var(--surface-3); color: var(--text-muted); border: 1px solid var(--border);
  }
  .tag-go { background: var(--good-bg); color: var(--good-text); border-color: var(--good-border); }
  .tag-reach { background: var(--warn-bg); color: var(--warn-text); border-color: var(--warn-border); }
  .tag-wait { background: var(--surface-3); color: var(--text-muted); border-color: var(--border); }

  .note { font-size: 13.5px; line-height: 1.55; }
  .note b { font-weight: 650; }
  .note-quiet { color: var(--text-muted); }
  .callout {
    background: var(--surface-2); border: 1px solid var(--border); border-left: 3px solid var(--border-strong);
    border-radius: 8px; padding: 10px 12px; font-size: 13.5px; line-height: 1.55;
  }
  .callout b { display: block; font-size: 11px; text-transform: uppercase; letter-spacing: .05em; color: var(--text-soft); margin-bottom: 3px; }

  details.more { border-top: 1px solid var(--border); padding-top: 10px; }
  details.more > summary {
    cursor: pointer; list-style: none; font-size: 13px; font-weight: 620; color: var(--link);
    display: flex; align-items: center; gap: 6px;
  }
  details.more > summary::-webkit-details-marker { display: none; }
  details.more > summary::before { content: "\\25B8"; font-size: 10px; transition: transform .12s ease; }
  details.more[open] > summary::before { transform: rotate(90deg); }
  details.more > .more-body { display: grid; gap: 12px; padding-top: 12px; }

  .bars { display: grid; gap: 7px; }
  .bar { display: grid; grid-template-columns: 92px 1fr 44px; gap: 9px; align-items: center; font-size: 12.5px; }
  .bar .track { height: 7px; border-radius: 999px; background: var(--surface-3); overflow: hidden; }
  .bar .fill { display: block; height: 100%; border-radius: 999px; background: var(--accent); }
  @media (prefers-color-scheme: dark) { .bar .fill { background: var(--link); } }
  .bar .value { text-align: right; color: var(--text-muted); font-variant-numeric: tabular-nums; }
  .bar.total .track { display: none; }
  .bar.total { grid-template-columns: 92px 1fr; font-weight: 650; }

  .kv { display: grid; gap: 8px; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); }
  .kv > div { background: var(--surface-2); border: 1px solid var(--border); border-radius: 8px; padding: 9px 10px; }
  .kv span { display: block; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: var(--text-soft); margin-bottom: 2px; }
  .kv strong { font-size: 13.5px; font-weight: 620; overflow-wrap: anywhere; }

  .feedback { display: grid; gap: 8px; border-top: 1px solid var(--border); padding-top: 12px; }
  .feedback .label { font-size: 12px; color: var(--text-soft); }
  .feedback .row { display: flex; gap: 7px; flex-wrap: wrap; }
  .feedback button { font-size: 12.5px; padding: 6px 9px; min-height: 32px; }

  .list { display: grid; gap: 9px; }
  .listrow { display: grid; gap: 5px; padding: 11px 12px; border: 1px solid var(--border); border-radius: 9px; background: var(--surface-2); }
  .listrow strong { font-size: 14px; line-height: 1.35; }
  .listrow .meta { font-size: 12.5px; color: var(--text-muted); line-height: 1.45; }

  .table-wrap { overflow-x: auto; border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); box-shadow: var(--shadow); }
  table { width: 100%; border-collapse: collapse; font-size: 13.5px; }
  th, td { padding: 10px 13px; text-align: left; vertical-align: top; border-bottom: 1px solid var(--border); }
  th { font-size: 11px; text-transform: uppercase; letter-spacing: .05em; color: var(--text-soft); font-weight: 700; background: var(--surface-2); position: sticky; top: 0; }
  tbody tr:last-child td { border-bottom: 0; }
  tr.group td { background: var(--surface-2); font-weight: 700; font-size: 12px; text-transform: uppercase; letter-spacing: .04em; color: var(--text-muted); }
  td.num { font-variant-numeric: tabular-nums; white-space: nowrap; }

  .tiles { display: grid; gap: 10px; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); }
  .tile { display: grid; gap: 5px; padding: 14px; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); box-shadow: var(--shadow); align-content: start; }
  .tile .big { font-size: 26px; font-weight: 700; line-height: 1; }
  .tile .cap { font-size: 13px; color: var(--text-muted); line-height: 1.45; }

  .runrow { display: grid; grid-template-columns: 104px minmax(0, 1fr); gap: 14px; padding: 14px 16px; align-items: start; }
  .runrow .body { display: grid; gap: 9px; }
  .runrow .chips { display: flex; gap: 6px 12px; flex-wrap: wrap; font-size: 12.5px; color: var(--text-muted); }

  @media (max-width: 720px) {
    .cards { grid-template-columns: 1fr; }
    .runrow { grid-template-columns: 1fr; }
    .bar { grid-template-columns: 78px 1fr 40px; }
    .contextbar { justify-content: flex-start; }
  }
`;

export const loginStyles = `
  body { min-height: 100vh; display: grid; place-items: center; padding: 24px; }
  main { width: min(100%, 400px); display: grid; gap: 16px; }
  .intro { display: grid; gap: 5px; }
  .intro h1 { font-size: 26px; }
  .intro p { color: var(--text-muted); font-size: 14px; line-height: 1.5; }
  form { display: grid; gap: 12px; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 18px; box-shadow: var(--shadow); }
  label { display: grid; gap: 6px; font-size: 12.5px; color: var(--text-muted); font-weight: 600; }
  input { width: 100%; min-height: 40px; border: 1px solid var(--border-strong); border-radius: 8px; padding: 8px 11px; font: inherit; color: var(--text); background: var(--surface-2); }
  form button { min-height: 40px; }
  .banner { border-radius: 8px; padding: 10px 12px; font-size: 13.5px; border: 1px solid; }
  .banner-warning { background: var(--warn-bg); color: var(--warn-text); border-color: var(--warn-border); }
`;

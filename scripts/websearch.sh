#!/usr/bin/env bash
# websearch - Web search via Brave HTML or DuckDuckGo HTML
# Zero npm dependencies. Uses curl + python3 (macOS built-in).
#
# Usage: websearch "query" [-n 5]

set -euo pipefail

# ── Argument parsing ──────────────────────────────────────────────

query=""
max_results=5

while [[ $# -gt 0 ]]; do
  case "$1" in
    -n) max_results="$2"; shift 2 ;;
    *)  query="$1"; shift ;;
  esac
done

if [[ -z "$query" ]]; then
  echo "Usage: websearch \"query\" [-n 5]" >&2
  exit 1
fi

# URL-encode the query using python3 (built into macOS)
query_encoded=$(python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1]))" "$query")

# ── HTML parsing ──────────────────────────────────────────────────

parse_results() {
  local engine="$1"
  local html_content="$2"

  python3 -c "
import sys, re, urllib.parse

html_content = sys.argv[1]
engine_type = sys.argv[2]
max_count = int(sys.argv[3])

results = []

def output_result(title, url, snippet):
    print(f'TITLE: {title}')
    print(f'URL: {url}')
    print(f'SNIPPET: {snippet}')
    print('---END---')
    results.append(1)

def extract_snippet_from_block(block):
    snippet = ''
    generic_match = re.search(r'generic-snippet[^>]*>(.*?)</div>', block, re.DOTALL)
    if generic_match:
        snippet = re.sub(r'<[^>]+>', '', generic_match.group(1)).strip()[:200]
    if not snippet:
        text_candidates = re.findall(r'>([^<]{50,})<', block)
        for candidate in text_candidates:
            candidate = candidate.strip()
            skip_titles = ('Brave Search','Search','News','Models','Packages','Documentation')
            if candidate not in skip_titles and not candidate.endswith('>'):
                snippet = candidate[:200]
                break
    return snippet

if engine_type == 'brave':
    for match in re.finditer(r'data-pos=\"\d+\".*?data-type=\"web\"', html_content):
        if len(results) >= max_count:
            break
        start_idx = match.start()
        end_idx = len(html_content)
        next_match = re.search(r'data-pos=\"\d+\"', html_content[start_idx+1:])
        if next_match:
            end_idx = start_idx + 1 + next_match.start()
        block = html_content[start_idx:end_idx]

        url_match = re.search(r'href=\"(https?://[^\"]+)\"', block)
        if not url_match:
            continue
        raw_url = url_match.group(1)

        redirect_match = re.search(r'uddg=([^&]+)', raw_url)
        if redirect_match:
            raw_url = urllib.parse.unquote(urllib.parse.unquote(redirect_match.group(1)))

        title_match = re.search(r'class=\"[^\"]*title[^\"]*\"[^>]*>([^<]+)', block)
        title = title_match.group(1).strip() if title_match else ''
        skip_titles = ('Brave Search','Search','News','Models','Packages','Documentation','Images','Videos','Maps','Goggles')
        if not title or title in skip_titles:
            continue

        snippet = extract_snippet_from_block(block)
        output_result(title, raw_url, snippet)

else:
    for row_match in re.finditer(r'<div class=\"result\".*?</div>\s*</div>\s*</div>', html_content, re.DOTALL):
        if len(results) >= max_count:
            break
        block = row_match.group(0)
        title_match = re.search(r'<a class=\"result__a\"[^>]*>([^<]+)</a>', block)
        url_match = re.search(r'href=\"(https?://[^\"]+)\"', block)
        snippet_match = re.search(r'<a class=\"result__snippet\"[^>]*>([^<]+)</a>', block)
        if title_match and url_match:
            title = title_match.group(1).strip()
            url = url_match.group(1)
            snippet = snippet_match.group(1).strip() if snippet_match else ''
            output_result(title, url, snippet)
" "$html_content" "$engine" "$max_results"
}

# ── Search loop ───────────────────────────────────────────────────

search_engines=("brave" "duckduckgo")

for engine in "${search_engines[@]}"; do
  search_url=""
  case "$engine" in
    brave)     search_url="https://search.brave.com/search?q=${query_encoded}&source=web" ;;
    duckduckgo) search_url="https://html.duckduckgo.com/html/?q=${query_encoded}" ;;
  esac

  html_content=$(curl -sL -A "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" "$search_url" 2>/dev/null) || continue

  parsed_results=$(parse_results "$engine" "$html_content") || continue

  if [[ -n "$parsed_results" ]]; then
    count=0
    current_title=""
    current_url=""
    current_snippet=""

    while IFS= read -r line; do
      case "$line" in
        TITLE:*)   current_title="${line#TITLE: }" ;;
        URL:*)     current_url="${line#URL: }" ;;
        SNIPPET:*) current_snippet="${line#SNIPPET: }" ;;
        ---END---)
          count=$((count + 1))
          [[ $count -gt $max_results ]] && break
          [[ -z "$current_title" ]] && continue

          echo "--- Result ${count} ---"
          echo "Title: ${current_title}"
          echo "Link: ${current_url}"
          [[ -n "$current_snippet" && "$current_snippet" != "$current_url" ]] && echo "Snippet: ${current_snippet}"
          echo ""

          current_title=""
          current_url=""
          current_snippet=""
          ;;
      esac
    done <<< "$parsed_results"

    exit 0
  fi
done

echo "No results found."
exit 1

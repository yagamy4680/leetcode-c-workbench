#!/usr/bin/env python3
"""Fetch official public question data; author C bundles with the fetching skill."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
import re
import urllib.parse
import urllib.request

FIELDS = 'questionFrontendId title titleSlug difficulty isPaidOnly content topicTags { name } codeSnippets { langSlug code } similarQuestions'


def slug_from_url(value):
    if re.fullmatch(r'[a-z0-9-]+', value):
        return value
    url = urllib.parse.urlparse(value)
    match = re.match(r'^/problems/([a-z0-9-]+)(?:/|$)', url.path)
    if url.scheme != 'https' or url.hostname not in ('leetcode.com', 'www.leetcode.com') or url.username or url.password or not match:
        raise ValueError('Provide a canonical HTTPS LeetCode problem URL or slug.')
    return match.group(1)


def graphql(query):
    url = 'https://leetcode.com/graphql/?' + urllib.parse.urlencode({'query': query})
    request = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0', 'Referer': 'https://leetcode.com/'})
    with urllib.request.urlopen(request, timeout=25) as response:
        result = json.load(response)
    if result.get('errors'):
        raise ValueError('Official GraphQL request failed: ' + '; '.join(error.get('message', 'unknown error') for error in result['errors']))
    return result['data']


def question(slug):
    data = graphql('query { question(titleSlug: ' + json.dumps(slug) + ') { ' + FIELDS + ' } }')['question']
    if not data:
        raise ValueError('Official question was not returned: ' + slug)
    data['codeSnippets'] = [snippet for snippet in (data.get('codeSnippets') or []) if snippet['langSlug'] == 'c']
    data['similarQuestions'] = json.loads(data.get('similarQuestions') or '[]')
    return data


def references(question_data, metadata):
    result, seen = [], set()
    for similar in question_data['similarQuestions']:
        slug = similar['titleSlug']
        if slug in seen:
            continue
        seen.add(slug)
        resolved = metadata.get(slug) or {}
        item = {'title': similar['title'], 'slug': slug, 'difficulty': similar['difficulty'], 'url': 'https://leetcode.com/problems/' + slug + '/'}
        frontend_id = resolved.get('questionFrontendId')
        if frontend_id:
            item['frontendId'] = frontend_id
            if str(frontend_id).isdigit() and 1 <= int(frontend_id) <= 999999:
                item['id'] = int(frontend_id)
        if 'isPaidOnly' in resolved:
            item['isPaidOnly'] = resolved['isPaidOnly']
        result.append(item)
    return result


def collect(slug, collection=False, include_seed=False):
    seed = question(slug)
    targets = list(dict.fromkeys(item['titleSlug'] for item in seed['similarQuestions'])) if collection else [slug]
    if collection:
        targets = [target for target in targets if target != slug]
    if collection and include_seed and slug not in targets:
        targets.insert(0, slug)
    fetched = {slug: seed}
    failures = []
    def retrieve(target):
        try:
            return target, question(target), None
        except Exception as error:
            return target, None, str(error)
    with ThreadPoolExecutor(max_workers=3) as pool:
        for target, data, error in pool.map(retrieve, [target for target in targets if target != slug]):
            if error:
                failures.append({'slug': target, 'reason': error})
            else:
                fetched[target] = data
    metadata = dict(fetched)
    unresolved = sorted({item['titleSlug'] for data in fetched.values() for item in data['similarQuestions']} - metadata.keys())
    for start in range(0, len(unresolved), 10):
        chunk = unresolved[start:start + 10]
        query = 'query { ' + ' '.join(f'q{i}: question(titleSlug: {json.dumps(target)}) {{ questionFrontendId title titleSlug difficulty isPaidOnly }}' for i, target in enumerate(chunk)) + ' }'
        try:
            response = graphql(query)
            for i, target in enumerate(chunk):
                if response.get(f'q{i}'):
                    metadata[target] = response[f'q{i}']
        except Exception as error:
            failures.append({'stage': 'similar-question-metadata', 'slugs': chunk, 'reason': str(error)})
    for data in fetched.values():
        data['workbenchSimilarQuestions'] = references(data, metadata)
    return seed, targets, fetched, failures


def write_sources(output, slug, seed, targets, fetched, failures, collection=False, include_seed=False):
    output.mkdir(parents=True, exist_ok=True)
    # Preserve the official seed list even when the seed is excluded from the ZIP.
    (output / 'seed-question.json').write_text(json.dumps(seed, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    entries, seen_ids = [], {}
    for target in targets:
        data = fetched.get(target)
        if not data:
            entries.append({'slug': target, 'status': 'unavailable', 'reason': 'See sourceFailures.'})
            continue
        frontend_id = str(data['questionFrontendId'])
        supported_id = frontend_id.isdigit() and 1 <= int(frontend_id) <= 999999
        if supported_id and int(frontend_id) in seen_ids:
            entries.append({'slug': target, 'frontendId': frontend_id, 'status': 'duplicate', 'duplicateOf': seen_ids[int(frontend_id)], 'reason': 'Same verified numeric frontend ID; author only one bundle.'})
            continue
        filename = f'question-{int(frontend_id)}.json' if supported_id else f'question-{target}.json'
        (output / filename).write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        reasons = []
        if not data.get('content'):
            reasons.append('Official description unavailable')
        if not any(snippet.get('code', '').strip() for snippet in data.get('codeSnippets', [])):
            reasons.append('Official C starter unavailable')
        if not supported_id:
            reasons.append('Unsupported frontend ID')
        entries.append({'slug': target, 'frontendId': frontend_id, 'sourceFile': filename, 'status': 'unavailable' if reasons else 'ready-to-author', 'reason': '; '.join(reasons) if reasons else None})
        if supported_id:
            seen_ids[int(frontend_id)] = target
    report = {'seedUrl': 'https://leetcode.com/problems/' + slug + '/', 'seedId': seed['questionFrontendId'], 'seedSourceFile': 'seed-question.json', 'scope': 'direct-similar-questions' if collection else 'single-question', 'includesSeed': not collection or include_seed, 'targets': entries, 'sourceFailures': failures, 'note': 'These are source records, not importable workbench bundles. Author and validate each problem JSON before packaging.'}
    (output / 'collection-source.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('url')
    parser.add_argument('--output-dir', required=True)
    parser.add_argument('--collection', action='store_true', help='Fetch direct similar questions; do not recursively expand.')
    parser.add_argument('--include-seed', action='store_true')
    args = parser.parse_args()
    try:
        slug = slug_from_url(args.url)
        seed, targets, fetched, failures = collect(slug, args.collection, args.include_seed)
        report = write_sources(Path(args.output_dir), slug, seed, targets, fetched, failures, args.collection, args.include_seed)
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return 1 if failures or any(entry['status'] == 'unavailable' for entry in report['targets']) else 0
    except Exception as error:
        print(json.dumps({'error': str(error)}))
        return 1


if __name__ == '__main__':
    raise SystemExit(main())

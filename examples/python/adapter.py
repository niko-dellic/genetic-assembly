"""Minimal language-neutral v2 adapter. Requires Python 3.10+, no third-party packages."""
import hashlib
import json
import os
import sys
import time
import urllib.request

PROTOCOL = 'genetic-assembly-adapter-v3'
BASE = os.environ.get('GA_INTERNAL_URL', 'http://127.0.0.1:3001')

def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':')).encode()).hexdigest()

def request(path, data=None):
    headers = {'Content-Type': 'application/json'}
    if os.environ.get('GA_API_TOKEN'):
        headers['Authorization'] = 'Bearer ' + os.environ['GA_API_TOKEN']
    req = urllib.request.Request(BASE + path, None if data is None else json.dumps(data).encode(), headers)
    with urllib.request.urlopen(req, timeout=30) as response:
        return json.load(response)

def evaluate(candidate, phase):
    x = candidate['genes'][0]
    seeds = spec['validationSeeds' if phase == 'validation' else 'searchSeeds']
    measurements = []
    for seed in seeds:
        started = time.monotonic()
        decisions = {'x': x}
        key = digest({'runtime': runtime, 'spec': spec, 'decisions': decisions, 'seed': seed, 'phase': phase})
        metrics = {'left': x*x, 'right': (1-x)*(1-x)}
        record = dict(id=digest([owner, candidate['id'], phase, seed]), ownerId=owner, studyId=study,
                      candidateId=str(candidate['id']), designHash=digest(decisions), phase=phase,
                      seed=seed, decisions=decisions, status='completed', metrics=metrics,
                      constraints={'domain_validity': 0}, warnings=[], repairs=[], cacheKey=key,
                      cached=False, runtimeMs=(time.monotonic()-started)*1000)
        request('/v3/evaluations', record)
        measurements.append(metrics)
    return {'id': candidate['id'], 'genes': candidate['genes'], 'evaluation': {
        'objectives': [sum(m[g['metric']] for m in measurements)/len(measurements) for g in spec['objectives'].values()],
        'constraints': [0]}}

for line in sys.stdin:
    message = {}
    try:
        message = json.loads(line)
        if message['protocol_version'] != PROTOCOL:
            raise ValueError('Unsupported adapter protocol')
        kind = message['type']
        if kind == 'initialize':
            owner = message['run_id']
            metadata = message['problem']['metadata']
            study, runtime, spec = metadata['studyId'], metadata['runtimeIdentity'], metadata['study']
            # Preserve the explicit compiled objective order; JSON object order is not a protocol guarantee.
            goals = message['problem']['problem']['objectives']
            spec['objectives'] = {goal['name']: spec['objectives'][goal['name']] for goal in goals}
            response = {'type': 'initialized', 'adapter_version': runtime, 'capabilities': {
                'operator_mode': 'builtin', 'max_concurrency': 1, 'validate_front': True, 'materialize': True}}
        elif kind in ('evaluate_batch', 'validate_front'):
            response = {'type': 'front_validated' if kind == 'validate_front' else 'batch_evaluated',
                        'candidates': [evaluate(c, 'validation' if kind == 'validate_front' else 'search') for c in message['candidates']]}
        elif kind == 'materialize':
            response = {'type': 'materialized', 'candidates': [{'id': c['id'], 'media_type': 'application/json', 'data': {'x': c['genes'][0]}} for c in message['candidates']]}
        elif kind in ('shutdown', 'cancel'):
            response = {'type': 'shutdown' if kind == 'shutdown' else 'cancelled'}
        else:
            raise ValueError('Unsupported message: ' + kind)
    except Exception as error:
        response = {'type': 'error', 'retryable': False, 'message': str(error)}
    print(json.dumps(dict(protocol_version=PROTOCOL, request_id=message.get('request_id'), **response)), flush=True)
    if message.get('type') == 'shutdown':
        break

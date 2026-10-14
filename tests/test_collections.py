import copy
import importlib.util
import io
import json
from pathlib import Path
import stat
import struct
import tempfile
import unittest
from unittest.mock import patch
import warnings
import zipfile

ROOT = Path(__file__).resolve().parents[1]

def load_script(name, filename):
    spec = importlib.util.spec_from_file_location(name, ROOT/'scripts'/filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

zip_reader = load_script('zip_reader', 'read-problem-zip.py')
fetcher = load_script('question_fetcher', 'fetch-leetcode-question.py')

def archive(entries):
    stream = io.BytesIO()
    with warnings.catch_warnings():
        warnings.simplefilter('ignore')
        with zipfile.ZipFile(stream, 'w', zipfile.ZIP_DEFLATED) as handle:
            for name, content in entries:
                handle.writestr(name, content)
    return stream.getvalue()

class CollectionTests(unittest.TestCase):
    def setUp(self):
        self.bundle = json.loads((ROOT/'bundles/problem-94.json').read_text())

    def test_zip_reads_nested_bundles_and_report_without_extracting(self):
        raw = archive([('folder/problem.json',json.dumps(self.bundle)),('_collection.json',json.dumps({'included':[94],'unavailable':[],'complete':True})),('.DS_Store','ignored')])
        result = zip_reader.read_archive(raw)
        self.assertEqual(result['entries'][0]['bundle']['manifest']['id'],94)
        self.assertTrue(result['collectionReport']['complete'])

    def test_zip_rejects_paths_links_duplicates_encryption_and_large_entries(self):
        valid = json.dumps(self.bundle)
        link = zipfile.ZipInfo('problem-94.json');link.create_system=3;link.external_attr=(stat.S_IFLNK|0o777)<<16
        bad = [archive([('../problem-94.json',valid)]),archive([(link,'outside')]),archive([('problem-94.json',valid),('problem-94.json',valid)]),archive([('problem-94.json',valid),('nested/problem.json',valid)]),archive([('problem-95.json',valid)]),archive([('note.txt','unexpected')]),archive([('problem.json','x'*(12*1024*1024+1))])]
        encrypted = bytearray(archive([('problem-94.json',valid)]));central=encrypted.find(b'PK\x01\x02');struct.pack_into('<H',encrypted,central+8,1);bad.append(bytes(encrypted))
        for raw in bad:
            with self.subTest(bytes=len(raw)):
                with self.assertRaises((ValueError,RuntimeError,zipfile.BadZipFile)):
                    zip_reader.read_archive(raw)

    def test_report_cannot_claim_missing_ids_or_complete_with_omissions(self):
        for report in ({'included':[144]}, {'unavailable':[{'slug':'restricted','reason':'No C snippet'}],'complete':True}):
            with self.assertRaises(ValueError):
                zip_reader.read_archive(archive([('problem-94.json',json.dumps(self.bundle)),('_collection.json',json.dumps(report))]))

    def test_collection_follows_direct_targets_without_recursing(self):
        def source(slug, numeric, related):
            return {'questionFrontendId':str(numeric),'title':slug,'titleSlug':slug,'difficulty':'Easy','isPaidOnly':False,'content':'<p>Fixture</p>','codeSnippets':[{'langSlug':'c','code':'int fixture(void) {}'}],'similarQuestions':[{'title':target,'titleSlug':target,'difficulty':'Easy'} for target in related]}
        fixtures={'seed':source('seed',1,['related','related']),'related':source('related',2,['next-hop'])}
        with patch.object(fetcher,'question',side_effect=lambda slug:copy.deepcopy(fixtures[slug])) as request,patch.object(fetcher,'graphql',return_value={'q0':{'questionFrontendId':'3','isPaidOnly':True}}):
            seed,targets,records,failures=fetcher.collect('seed',collection=True)
        self.assertEqual(targets,['related']);self.assertEqual({call.args[0] for call in request.call_args_list},{'seed','related'})
        self.assertEqual(records['related']['workbenchSimilarQuestions'][0]['id'],3)
        self.assertTrue(records['related']['workbenchSimilarQuestions'][0]['isPaidOnly']);self.assertEqual(failures,[])

    def test_source_failures_are_explicit_and_urls_cannot_supply_credentials(self):
        seed={'questionFrontendId':'1','titleSlug':'seed','similarQuestions':[{'title':'Missing','titleSlug':'missing','difficulty':'Easy'}]}
        def request(slug):
            if slug=='seed':return copy.deepcopy(seed)
            raise ValueError('Official source unavailable')
        with patch.object(fetcher,'question',side_effect=request),patch.object(fetcher,'graphql',return_value={}):
            _,targets,records,failures=fetcher.collect('seed',collection=True)
        self.assertEqual(targets,['missing']);self.assertNotIn('missing',records);self.assertTrue(failures)
        with self.assertRaises(ValueError):fetcher.slug_from_url('https://user:password@leetcode.com/problems/test/')
        self.assertEqual(fetcher.slug_from_url('https://leetcode.com/problems/binary-tree-preorder-traversal/'),'binary-tree-preorder-traversal')

    def test_source_report_preserves_seed_deduplicates_ids_and_names_missing_evidence(self):
        seed = {'questionFrontendId':'1','similarQuestions':[{'titleSlug':'first'},{'titleSlug':'alias'},{'titleSlug':'premium'}]}
        first = {'questionFrontendId':'2','content':'<p>Official</p>','codeSnippets':[{'code':'int first(void);'}]}
        premium = {'questionFrontendId':'3','content':None,'codeSnippets':[]}
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            report = fetcher.write_sources(output,'seed',seed,['first','alias','premium'],{'first':first,'alias':dict(first,content='Alias'),'premium':premium},[],collection=True)
            self.assertEqual(json.loads((output/'seed-question.json').read_text()), seed)
            self.assertEqual(json.loads((output/'question-2.json').read_text()), first)
            self.assertEqual(report['targets'][1]['status'],'duplicate')
            self.assertEqual(report['targets'][1]['duplicateOf'],'first')
            self.assertIn('description unavailable',report['targets'][2]['reason'])
            self.assertIn('C starter unavailable',report['targets'][2]['reason'])
            self.assertNotIn('frontend ID',report['targets'][2]['reason'])

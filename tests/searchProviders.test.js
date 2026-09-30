import { describe, expect, it, vi } from 'vitest';
import { runSearch, validatePublicSearchUrl } from '../server/searchProviders.js';

function jsonResponse(body) {
  return {
    ok: true,
    status: 200,
    headers: new Headers({ 'content-type': 'application/json' }),
    text: vi.fn().mockResolvedValue(JSON.stringify(body)),
  };
}

describe('search providers', () => {
  it('runs hosted web search with required search and source metadata', async () => {
    const create = vi.fn().mockResolvedValue({
      output_text: 'A sourced answer [1].',
      output: [
        {
          type: 'message',
          content: [{
            annotations: [{ type: 'url_citation', title: 'Source', url: 'https://example.com/fact' }],
          }],
        },
      ],
    });

    const result = await runSearch({
      provider: 'web',
      query: 'current fact',
      limit: 3,
      allowedDomains: 'example.com',
    }, {
      client: { responses: { create } },
      searchModel: 'gpt-5.6',
    });

    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      model: 'gpt-5.6',
      tool_choice: 'required',
      tools: [expect.objectContaining({
        type: 'web_search',
        filters: { allowed_domains: ['example.com'] },
      })],
    }));
    expect(result.sources).toEqual([{ title: 'Source', url: 'https://example.com/fact' }]);
  });

  it('returns raw hosted search records without the model summary', async () => {
    const create = vi.fn().mockResolvedValue({
      output_text: 'This text must not be returned.',
      output: [{
        type: 'web_search_call',
        results: [{
          title: 'Current source',
          url: 'https://example.com/current',
          snippet: '\uE200cite\uE202turn0search0\uE201 [wordlim: 200] <b>Raw</b> search evidence.',
        }],
        action: { sources: [] },
      }],
    });

    const result = await runSearch({
      provider: 'web',
      searchMode: 'raw',
      query: 'current fact',
      limit: 3,
    }, {
      client: { responses: { create } },
      searchModel: 'gpt-5.6',
    });

    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      reasoning: { effort: 'none' },
      include: ['web_search_call.results', 'web_search_call.action.sources'],
    }));
    expect(result).not.toHaveProperty('answer');
    expect(result.results).toEqual([{
      title: 'Current source',
      url: 'https://example.com/current',
      snippet: 'Raw search evidence.',
    }]);
  });

  it('normalizes Wikipedia API records', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({
      query: {
        search: [{ title: 'Ada Lovelace', snippet: '<span>Ada</span> wrote notes.' }],
      },
    }));
    const result = await runSearch({
      provider: 'wikipedia',
      query: 'Ada Lovelace',
      limit: 2,
    }, { fetchFn });

    expect(result.results[0]).toMatchObject({
      title: 'Ada Lovelace',
      snippet: 'Ada wrote notes.',
    });
    expect(fetchFn.mock.calls[0][0].hostname).toBe('en.wikipedia.org');
  });

  it('rejects private custom endpoints', async () => {
    await expect(validatePublicSearchUrl('http://example.com/search?q=x'))
      .rejects.toThrow('HTTPS');
    await expect(validatePublicSearchUrl('https://localhost/search?q=x'))
      .rejects.toThrow('public host');
    await expect(validatePublicSearchUrl(
      'https://search.example.com/?q=x',
      vi.fn().mockResolvedValue([{ address: '192.168.1.9' }]),
    )).rejects.toThrow('private or unsafe');
  });
});

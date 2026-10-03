import { describe, expect, it } from 'vitest'
import { fuseRankings, KeywordIndex, keywordScores, RRF_K, tokenize } from './keywordSearch'

describe('tokenize', () => {
  it('lowercases, ignores accents and possessives, and keeps numbers whole', () => {
    expect(tokenize("Rose Nakató's number: UNMC-1964-0381")).toEqual(['rose', 'nakato', 'number', 'unmc', '1964', '0381'])
  })

  it('splits Chinese and Japanese into overlapping character pairs', () => {
    expect(tokenize('祖母在马萨卡')).toEqual(['祖母', '母在', '在马', '马萨', '萨卡'])
    expect(tokenize('学')).toEqual(['学'])
  })
})

describe('KeywordIndex', () => {
  const sections = [
    'The family gathered every Sunday. The family sang and the family prayed together.',
    'The family Bible with all the birth records is kept at Joseph\'s house in Entebbe.',
    'Records of the harvest were written in a ledger by the family clerk.',
    'A long chapter about whaling ships and the open sea, with no family facts at all.',
  ]

  it('ranks the section with the rare question words first', () => {
    const index = new KeywordIndex(sections)
    expect(index.rank(['Where is the family Bible with the birth records kept?'])[0]).toBe(1)
  })

  it('ignores question words such as "where is the" and scores unrelated text as zero', () => {
    const scores = keywordScores(['Where is the?'], sections)
    expect(scores).toEqual([0, 0, 0, 0])
    expect(new KeywordIndex(sections).rank(['submarine'])).toEqual([])
  })

  it('combines the question with its English translation', () => {
    const index = new KeywordIndex(sections)
    expect(index.rank(['¿Dónde está la Biblia familiar?', 'Where is the family Bible?'])[0]).toBe(1)
  })

  it('finds exact numbers and names', () => {
    const index = new KeywordIndex(['Account 9030-4471-2286 at Stanbic Bank.', 'An account of the voyage.'])
    expect(index.rank(['What is the account number 9030-4471-2286?'])[0]).toBe(0)
  })

  it('handles an empty archive', () => {
    expect(new KeywordIndex([]).rank(['anything'])).toEqual([])
  })
})

describe('fuseRankings', () => {
  it('lifts an item that both rankings like over one that only a single ranking likes', () => {
    // Vector search alone ranks item 3 fourth; keyword search ranks it first.
    const vector = [0, 1, 2, 3, 4]
    const keyword = [3, 4]
    expect(fuseRankings([vector, keyword], 5).slice(0, 3)).toEqual([3, 4, 0])
  })

  it('keeps vector order when keyword search finds nothing', () => {
    expect(fuseRankings([[2, 0, 1], []], 3)).toEqual([2, 0, 1])
  })

  it('uses the standard reciprocal-rank constant', () => {
    expect(RRF_K).toBe(60)
  })
})

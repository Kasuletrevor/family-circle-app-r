import { describe, expect, it, vi } from 'vitest'
import { KeywordIndex } from './keywordSearch'
import { citedCandidates, isNotFoundAnswer, PrivateArchiveQueryService, PrivateArchiveQueryServiceError, type PrivateArchiveQueryServiceDependencies } from './PrivateArchiveQueryService'

function vaultChunk(documentId: number, fileName: string, chunkIndex: number, text: string, embedding: number[]) {
  return {
    documentId, fileName, chunkIndex, text,
    embedding: new Float32Array(embedding),
    embeddingModel: 'nomic-embed-text-v1.5.Q4_K_M',
    indexVersion: 1,
  }
}

function storyChunk(answerId: number, fieldKey: 'childhood' | 'values', chapter: string, label: string, text: string, embedding: number[]) {
  return {
    answerId, fieldKey, chapter, label, text,
    embedding: new Float32Array(embedding),
    embeddingModel: 'nomic-embed-text-v1.5.Q4_K_M',
    indexVersion: 1,
  }
}

function deps(overrides: Partial<PrivateArchiveQueryServiceDependencies> = {}): PrivateArchiveQueryServiceDependencies {
  return {
    session: { restore: vi.fn(async () => ({ id: 7 } as never)) },
    documents: { getByIdForUser: vi.fn(async (_userId, id) => ({ id, deleteStatus: 'active' } as never)) },
    vaultChunks: { listQueryChunks: vi.fn(async () => [vaultChunk(1, 'History.pdf', 0, 'Grandmother was born in Jinja.', [1, 0])]) },
    storyChunks: { listQueryChunks: vi.fn(async () => [storyChunk(2, 'childhood', 'Life Story', 'Childhood and early memories', 'I grew up near Jinja.', [0.9, 0.1])]) },
    runtime: {
      ensureEmbeddingRuntime: vi.fn(async () => true),
      ensureGenerationRuntime: vi.fn(async () => true),
    },
    nomic: { embedQuery: vi.fn(async () => new Float32Array([1, 0])) },
    qwen: {
      generateFast: vi.fn(async () => 'Fast grounded answer'),
      generateComplex: vi.fn(async () => 'Complex grounded answer'),
      translateForRetrieval: vi.fn(async () => 'Where was I born?'),
    },
    direct: { answer: vi.fn(async () => null) },
    ...overrides,
  }
}

describe('PrivateArchiveQueryService', () => {
  it('requires the protected session and validates every selected Vault document before any retrieval', async () => {
    const noSession = new PrivateArchiveQueryService(deps({ session: { restore: vi.fn(async () => null) } }))
    await expect(noSession.ask({ question: 'Where?', scope: { type: 'story' } })).rejects.toBeInstanceOf(PrivateArchiveQueryServiceError)
    await expect(noSession.ask({ question: 'Where?', scope: { type: 'story' } })).rejects.toMatchObject({ code: 'authentication-required' })

    const listStory = vi.fn(async () => [])
    const getByIdForUser = vi.fn(async (_userId: number, id: number) => id === 22 ? null : ({ id, deleteStatus: 'active' } as never))
    const service = new PrivateArchiveQueryService(deps({
      documents: { getByIdForUser },
      storyChunks: { listQueryChunks: listStory },
    }))

    await expect(service.ask({
      question: 'What is my name?',
      scope: { type: 'combined', vault: { type: 'documents', documentIds: [11, 22] } },
    })).rejects.toMatchObject({ code: 'invalid-scope' })
    expect(getByIdForUser).toHaveBeenCalledWith(7, 11)
    expect(getByIdForUser).toHaveBeenCalledWith(7, 22)
    expect(listStory).not.toHaveBeenCalled()
  })

  it('returns a direct confirmed Story fact without starting Nomic or Qwen', async () => {
    const direct = {
      answer: vi.fn(async () => ({
        answer: 'Amina Nansubuga',
        source: {
          sourceType: 'story' as const,
          chapter: 'Identity',
          label: 'Full name',
          fileName: 'My Story › Identity › Full name',
          excerpt: 'Amina Nansubuga',
        },
      })),
    }
    const dependencies = deps({ direct })
    const service = new PrivateArchiveQueryService(dependencies)

    const result = await service.ask({ question: 'What is my full name?', scope: { type: 'story' } })

    expect(result).toMatchObject({ answer: 'Amina Nansubuga', route: 'direct' })
    expect(dependencies.nomic.embedQuery).not.toHaveBeenCalled()
    expect(dependencies.qwen.generateFast).not.toHaveBeenCalled()
    expect(dependencies.qwen.generateComplex).not.toHaveBeenCalled()
  })

  it('ranks Story and Vault candidates together, keeps only three chunks total, and deduplicates citations by logical source', async () => {
    // The answer draws on both kept sources, so both are cited.
    const generateFast = vi.fn(async () => 'Grounded in A-TOP-1 and STORY-TOP-3')
    const service = new PrivateArchiveQueryService(deps({
      vaultChunks: {
        listQueryChunks: vi.fn(async () => [
          vaultChunk(1, 'A.pdf', 0, 'A-TOP-1', [1, 0]),
          vaultChunk(1, 'A.pdf', 1, 'A-TOP-2-SAME-DOC', [0.99, 0.01]),
          vaultChunk(3, 'C.pdf', 0, 'C-EXCLUDED-4', [0.6, 0.4]),
        ]),
      },
      storyChunks: {
        listQueryChunks: vi.fn(async () => [
          storyChunk(2, 'childhood', 'Life Story', 'Childhood and early memories', 'STORY-TOP-3', [0.95, 0.05]),
          storyChunk(4, 'values', 'Values & Wishes', 'Values and lessons', 'STORY-EXCLUDED-5', [0, 1]),
        ]),
      },
      qwen: {
        generateFast,
        generateComplex: vi.fn(async () => 'unused'),
        translateForRetrieval: vi.fn(async () => 'unused'),
      },
    }))

    const result = await service.ask({
      question: 'Tell me what is relevant.',
      scope: { type: 'combined', vault: { type: 'all' } },
    })

    expect(result.route).toBe('fast')
    expect(result.sources).toHaveLength(2)
    expect(result.sources.map((source) => source.fileName)).toEqual([
      'A.pdf',
      'My Story › Life Story › Childhood and early memories',
    ])
    const [, context] = generateFast.mock.calls[0]!
    expect(context).toContain('A-TOP-1')
    expect(context).toContain('A-TOP-2-SAME-DOC')
    expect(context).toContain('STORY-TOP-3')
    expect(context).not.toContain('C-EXCLUDED-4')
    expect(context).not.toContain('STORY-EXCLUDED-5')
  })

  it('uses Qwen translation plus original and translated embeddings for supported non-English retrieval', async () => {
    const embedQuery = vi.fn(async (query: string) => query.startsWith('Where')
      ? new Float32Array([0.8, 0.2])
      : new Float32Array([1, 0]))
    const translateForRetrieval = vi.fn(async () => 'Where was I born?')
    const service = new PrivateArchiveQueryService(deps({
      nomic: { embedQuery },
      qwen: {
        generateFast: vi.fn(async () => 'Answer'),
        generateComplex: vi.fn(async () => 'unused'),
        translateForRetrieval,
      },
    }))

    await service.ask({ question: '¿Dónde nací?', language: 'es', scope: { type: 'story' } })

    expect(translateForRetrieval).toHaveBeenCalledWith('¿Dónde nací?')
    expect(embedQuery.mock.calls.map(([query]) => query)).toEqual(['¿Dónde nací?', 'Where was I born?'])
  })

  it('reuses the English retrieval translation to select the complex Qwen budget for non-English combined synthesis', async () => {
    const generateFast = vi.fn(async () => 'fast')
    const generateComplex = vi.fn(async () => 'complex')
    const translateForRetrieval = vi.fn(async () => 'Compare my story and documents.')
    const service = new PrivateArchiveQueryService(deps({
      qwen: {
        generateFast,
        generateComplex,
        translateForRetrieval,
      },
    }))

    const result = await service.ask({
      question: 'Compara mi historia y mis documentos.',
      language: 'es',
      scope: { type: 'combined', vault: { type: 'all' } },
    })

    expect(translateForRetrieval).toHaveBeenCalledTimes(1)
    expect(result.route).toBe('complex')
    expect(result.answer).toBe('complex')
    expect(generateComplex).toHaveBeenCalledTimes(1)
    expect(generateFast).not.toHaveBeenCalled()
  })

  it('skips malformed vectors and returns a safe no-context answer without starting generation', async () => {
    const ensureGenerationRuntime = vi.fn(async () => true)
    const generateFast = vi.fn(async () => 'should not run')
    const service = new PrivateArchiveQueryService(deps({
      vaultChunks: { listQueryChunks: vi.fn(async () => [vaultChunk(1, 'Bad.pdf', 0, 'bad vector', [1, 0, 0])]) },
      storyChunks: { listQueryChunks: vi.fn(async () => []) },
      runtime: {
        ensureEmbeddingRuntime: vi.fn(async () => true),
        ensureGenerationRuntime,
      },
      qwen: {
        generateFast,
        generateComplex: vi.fn(async () => 'unused'),
        translateForRetrieval: vi.fn(async () => 'unused'),
      },
    }))

    const result = await service.ask({ question: 'Anything?', scope: { type: 'vault', vault: { type: 'all' } } })

    expect(result.answer).toBe('I could not find it in the selected Vault documents.')
    expect(result.sources).toEqual([])
    expect(ensureGenerationRuntime).not.toHaveBeenCalled()
    expect(generateFast).not.toHaveBeenCalled()
  })

  it('uses the same Qwen model with the complex token budget for explicit combined synthesis', async () => {
    const generateFast = vi.fn(async () => 'fast')
    const generateComplex = vi.fn(async () => 'complex')
    const service = new PrivateArchiveQueryService(deps({
      qwen: {
        generateFast,
        generateComplex,
        translateForRetrieval: vi.fn(async () => 'unused'),
      },
    }))

    const result = await service.ask({
      question: 'Compare my story and documents and explain the differences.',
      scope: { type: 'combined', vault: { type: 'all' } },
    })

    expect(result.route).toBe('complex')
    expect(result.answer).toBe('complex')
    expect(generateComplex).toHaveBeenCalledTimes(1)
    expect(generateFast).not.toHaveBeenCalled()
  })

  it('fails safely when the shared Qwen runtime is unavailable', async () => {
    const service = new PrivateArchiveQueryService(deps({
      runtime: {
        ensureEmbeddingRuntime: vi.fn(async () => true),
        ensureGenerationRuntime: vi.fn(async () => false),
      },
    }))

    await expect(service.ask({
      question: 'Summarize this.',
      scope: { type: 'vault', vault: { type: 'all' } },
    })).rejects.toMatchObject({ code: 'private-ai-unavailable' })
  })

  it('replaces a NOT_FOUND model reply with the local not-found answer and no sources', async () => {
    const service = new PrivateArchiveQueryService(deps({
      qwen: {
        generateFast: vi.fn(async () => 'NOT_FOUND'),
        generateComplex: vi.fn(async () => 'NOT_FOUND'),
        translateForRetrieval: vi.fn(async () => ''),
      },
    }))

    await expect(service.ask({ question: 'What car does Joseph drive?', scope: { type: 'vault', vault: { type: 'all' } } }))
      .resolves.toMatchObject({ answer: 'I could not find it in the selected Vault documents.', sources: [] })
    await expect(service.ask({ question: 'What car does Joseph drive?', scope: { type: 'story' } }))
      .resolves.toMatchObject({ answer: 'I could not find it in your confirmed My Story memories.', sources: [] })
  })

  it('keeps a worded not-found reply but drops the sources it did not use', async () => {
    const reply = 'Based on the provided context, there is no information regarding any car Joseph drives. The text covers family history.'
    const service = new PrivateArchiveQueryService(deps({
      qwen: {
        generateFast: vi.fn(async () => reply),
        generateComplex: vi.fn(async () => reply),
        translateForRetrieval: vi.fn(async () => ''),
      },
    }))

    await expect(service.ask({ question: 'What car does Joseph drive?', scope: { type: 'vault', vault: { type: 'all' } } }))
      .resolves.toMatchObject({ answer: reply, sources: [] })
  })

  it('lifts an exact-word match that meaning-based search ranks outside the top three', async () => {
    const generateFast = vi.fn(async () => "It is kept at Joseph's house in Entebbe.")
    const service = new PrivateArchiveQueryService(deps({
      vaultChunks: {
        listQueryChunks: vi.fn(async () => [
          vaultChunk(1, 'Book.pdf', 0, 'The family gathered by the fire and told old stories.', [1, 0]),
          vaultChunk(1, 'Book.pdf', 1, 'Every family has its records and its customs.', [0.98, 0.02]),
          vaultChunk(1, 'Book.pdf', 2, 'Grandmother kept the family close in hard years.', [0.96, 0.04]),
          vaultChunk(1, 'Book.pdf', 3, "The family Bible with all the birth records is kept at Joseph's house in Entebbe.", [0.9, 0.1]),
        ]),
      },
      qwen: {
        generateFast,
        generateComplex: vi.fn(async () => 'unused'),
        translateForRetrieval: vi.fn(async () => 'unused'),
      },
    }))

    await service.ask({ question: 'Where is the family Bible kept?', scope: { type: 'vault', vault: { type: 'all' } } })

    const [, context] = generateFast.mock.calls[0]!
    expect(context).toContain('Bible')
  })

  it('rebuilds the keyword index when the sections change', async () => {
    let texts = ['Rose kept the deeds in a red tin.', 'Nothing about property here.']
    const generateFast = vi.fn(async () => 'answer')
    const service = new PrivateArchiveQueryService(deps({
      vaultChunks: {
        listQueryChunks: vi.fn(async () => texts.map((text, index) => vaultChunk(1, 'Notes.txt', index, text, [0.5, 0.5]))),
      },
      qwen: {
        generateFast,
        generateComplex: vi.fn(async () => 'unused'),
        translateForRetrieval: vi.fn(async () => 'unused'),
      },
    }))
    const contextFor = async (question: string) => {
      await service.ask({ question, scope: { type: 'vault', vault: { type: 'all' } } })
      return String(generateFast.mock.calls.at(-1)![1]).split('\n\n')[0]
    }

    expect(await contextFor('Where are the deeds?')).toContain('red tin')
    texts = ['Nothing about property here.', 'The deeds moved to a blue box at the bank.']
    expect(await contextFor('Where are the deeds?')).toContain('blue box')
  })

  it('keeps sources for real answers', async () => {
    const service = new PrivateArchiveQueryService(deps())
    const result = await service.ask({ question: 'Where was grandmother born?', scope: { type: 'vault', vault: { type: 'all' } } })
    expect(result.sources.length).toBeGreaterThan(0)
  })
})

describe('citedCandidates', () => {
  const doctor = { text: 'Medical summary. The family doctor is Dr. Okello at Nsambya Hospital in Kampala.' }
  const job = { text: 'I work as a software engineer building privacy-first family apps.' }
  const study = { text: 'I studied computer science at Makerere University and graduated in 2019.' }
  const traditions = { text: 'Our family tradition is gathering in Masaka every Christmas, cooking chicken luwombo together and telling stories under the mango tree.' }
  const archive = [doctor, job, study, traditions]
  // Rarity is measured across every section in scope, as the service does.
  const cite = (answer: string, ranked: Array<{ text: string }>, scope = archive) =>
    citedCandidates(answer, ranked, new KeywordIndex(scope.map((section) => section.text)))

  it('cites only the sections the answer draws on, even when one ranked higher', () => {
    expect(cite('The family doctor is Dr. Okello at Nsambya Hospital.', [job, doctor, study])).toEqual([doctor])
  })

  it('cites every section the answer combines', () => {
    expect(cite('You studied at Makerere University and now work as a software engineer.', [study, doctor, job]))
      .toEqual([study, job])
  })

  it('cites each English section a translated answer combines, from one distinctive word each', () => {
    const born = { text: 'Grandmother was born in Jinja in 1941.' }
    const works = { text: 'Uncle Peter works in Kampala as a teacher.' }
    const other = { text: 'The family gathers every Sunday after church.' }
    const scope = [born, works, other, job, study]
    expect(cite('Grand-mère est née à Jinja et oncle Peter travaille à Kampala.', [other, born, works], scope))
      .toEqual([born, works])
  })

  it('traces a Japanese answer to the English section whose name and year it kept', () => {
    const born = { text: 'Grandmother was born in Jinja in 1941.' }
    const works = { text: 'Uncle Peter works in Kampala as a teacher.' }
    const scope = [born, works, job, study]
    expect(cite('祖母はJinjaで1941年に生まれました。', [works, born], scope)).toEqual([born])
  })

  it('treats overlapping sections of one document as one source when judging rarity', () => {
    // A fact in the 150-character overlap appears in two sections of the same document.
    const first = { text: 'Chapter one. The deed is kept in the red tin at Mbarara.' }
    const second = { text: 'The deed is kept in the red tin at Mbarara. Chapter two begins.' }
    const other = { text: 'Uncle Peter works in Kampala as a teacher.' }
    const index = new KeywordIndex([first.text, second.text, other.text], ['document:1', 'document:1', 'document:2'])
    expect(citedCandidates('The deed is in the red tin at Mbarara.', [first, other, second], index))
      .toEqual([first, second])
  })

  it('ignores common French words even when French sections are a small minority', () => {
    const english = Array.from({ length: 100 }, (_, n) => ({ text: `Family record ${n}: the harvest was good in Masaka that year.` }))
    const rose = { text: 'Elle est infirmière à Mulago depuis 1990.' }
    const grace = { text: 'Elle habite à Kampala avec ses enfants.' }
    const scope = [...english, rose, grace]
    expect(cite('Elle travaille à Mulago depuis 1990.', [grace, rose], scope)).toEqual([rose])
  })

  it('does not cite sections that share only common words, in any language', () => {
    const french = [
      'Elle habite dans la ville de Masaka depuis 1990.',
      'Il travaille dans la ville de Kampala comme infirmier.',
      'Nous allons dans la ville de Jinja chaque été.',
      'Ils sont nés dans la ville de Entebbe.',
      'La famille se réunit dans la ville de Mbarara.',
    ].map((text) => ({ text }))
    expect(cite('Elle habite dans la ville de Masaka.', [french[1]!, french[0]!, french[2]!], french))
      .toEqual([french[0]])
  })

  it('lists every section the model read when the answer cannot be traced to one', () => {
    // A fully translated paraphrase keeps no names or numbers, so no single section can be named.
    const nurse = { text: 'Aunt Rose works as a nurse at the district hospital.' }
    const scope = [nurse, job, study, doctor]
    expect(cite('Elle est infirmière.', [job, nurse, study], scope)).toEqual([job, nurse, study])
    expect(cite('Yes.', [doctor, job])).toEqual([doctor, job])
  })

  it('does not count a word found in most sections, even in a scope of two', () => {
    const masaka = { text: 'Elle habite dans la ville de Masaka depuis 1990.' }
    const kampala = { text: 'Il travaille dans la ville de Kampala comme infirmier.' }
    // "dans la ville de" is in both sections, so only "Masaka" can tell them apart.
    expect(cite('Elle habite dans la ville de Masaka.', [kampala, masaka], [masaka, kampala])).toEqual([masaka])
  })

  it('drops the unrelated sources from real answers recorded with Qwen3.5 0.8B', () => {
    // French answer (2026-10-02): the old top-3 also cited "What I do" and the medical summary.
    expect(cite("J'ai étudié en informatique à Makerere University.", [job, study, doctor])).toEqual([study])
    // Combined answer (2026-10-02): the traditions memory is cited, the job memory is not.
    expect(cite(
      'Our family tradition at Christmas involves gathering in Masaka to cook chicken luwombo together and to tell stories under a mango tree.',
      [traditions, job, study],
    )).toEqual([traditions])
  })
})

describe('PrivateArchiveQueryService question priority', () => {
  it('marks a question in progress for its whole duration, even when it fails', async () => {
    const events: string[] = []
    const interactiveGate = { begin: vi.fn(() => { events.push('begin'); return () => events.push('end') }) }
    const service = new PrivateArchiveQueryService(deps({ interactiveGate }))
    await service.ask({ question: 'Where was grandmother born?', scope: { type: 'vault', vault: { type: 'all' } } })
    expect(events).toEqual(['begin', 'end'])

    const failing = new PrivateArchiveQueryService(deps({
      interactiveGate,
      runtime: { ensureEmbeddingRuntime: vi.fn(async () => false), ensureGenerationRuntime: vi.fn(async () => true) },
    }))
    await expect(failing.ask({ question: 'Where?', scope: { type: 'vault', vault: { type: 'all' } } })).rejects.toMatchObject({ code: 'private-ai-unavailable' })
    expect(events).toEqual(['begin', 'end', 'begin', 'end'])
  })
})

describe('PrivateArchiveQueryService languages', () => {
  it('passes the selected language to the answer model and localises not-found answers', async () => {
    const generateFast = vi.fn(async () => 'Grand-mère est née à Jinja.')
    const service = new PrivateArchiveQueryService(deps({
      qwen: { generateFast, generateComplex: vi.fn(), translateForRetrieval: vi.fn(async () => 'Where was grandmother born?') },
    }))
    await expect(service.ask({ question: 'Où grand-mère est-elle née ?', scope: { type: 'vault', vault: { type: 'all' } }, language: 'fr' }))
      .resolves.toMatchObject({ answer: 'Grand-mère est née à Jinja.' })
    expect(generateFast).toHaveBeenCalledWith('Où grand-mère est-elle née ?', expect.any(String), 'French')

    const notFound = new PrivateArchiveQueryService(deps({
      qwen: { generateFast: vi.fn(async () => 'NOT_FOUND'), generateComplex: vi.fn(), translateForRetrieval: vi.fn(async () => 'What car?') },
    }))
    await expect(notFound.ask({ question: 'Quelle voiture ?', scope: { type: 'vault', vault: { type: 'all' } }, language: 'fr' }))
      .resolves.toMatchObject({ answer: "Je ne l'ai pas trouvé dans vos sources privées.", sources: [] })
  })

  it('treats a spelled-out "Not found" like the sentinel', async () => {
    // Real Granite 4.0 1B reply when asked to answer in French with no supporting source.
    const notFound = new PrivateArchiveQueryService(deps({
      qwen: { generateFast: vi.fn(async () => 'Not found'), generateComplex: vi.fn(), translateForRetrieval: vi.fn(async () => 'What car?') },
    }))
    await expect(notFound.ask({ question: 'Quelle voiture ?', scope: { type: 'vault', vault: { type: 'all' } }, language: 'fr' }))
      .resolves.toMatchObject({ answer: "Je ne l'ai pas trouvé dans vos sources privées.", sources: [] })
  })
})

describe('isNotFoundAnswer', () => {
  it('recognises the sentinel and common not-found wording in the first sentence', () => {
    for (const reply of [
      'NOT_FOUND',
      'not_found.',
      'I could not find it in the selected private sources.',
      'There is no information about a car in the context.',
      'The context does not mention Joseph’s car.',
      'Based on the sources, his job is not mentioned.',
    ]) {
      expect(isNotFoundAnswer(reply), reply).toBe(true)
    }
  })

  it('does not flag real answers, even when a later sentence notes a gap', () => {
    for (const reply of [
      'Rose Nakato worked at Mulago Hospital for thirty-one years.',
      'Daniel Ssempa is allergic to penicillin. The sources do not mention other allergies.',
      'The family doctor is Dr. Okello at Nsambya Hospital.',
    ]) {
      expect(isNotFoundAnswer(reply), reply).toBe(false)
    }
  })
})

describe('findStorySections', () => {
  const stories = [
    storyChunk(2, 'childhood', 'Life Story', 'Where I grew up', 'We lived by Lake Victoria in Entebbe.', [1, 0]),
    storyChunk(3, 'values', 'Life Story', 'What I value', 'Honesty and hard work at Gayaza High School.', [0, 1]),
  ]

  it('ranks confirmed My Story sections, never reads the Vault, and cites the ones a reply used', async () => {
    const vault = vi.fn(async () => [])
    const service = new PrivateArchiveQueryService(deps({
      storyChunks: { listQueryChunks: vi.fn(async () => stories) },
      vaultChunks: { listQueryChunks: vault },
    }))
    const found = await service.findStorySections(7, 'Tell me about the lake')
    expect(found.sections[0]).toEqual({ label: 'My Story › Life Story › Where I grew up', text: 'We lived by Lake Victoria in Entebbe.' })
    expect(found.cite('You lived by Lake Victoria in Entebbe.')).toEqual([
      { label: 'My Story › Life Story › Where I grew up', excerpt: 'We lived by Lake Victoria in Entebbe.' },
    ])
    expect(vault).not.toHaveBeenCalled()
  })

  it('returns nothing when no story is indexed and fails when search is down', async () => {
    const empty = new PrivateArchiveQueryService(deps({ storyChunks: { listQueryChunks: vi.fn(async () => []) } }))
    await expect(empty.findStorySections(7, 'Hi')).resolves.toMatchObject({ sections: [] })
    const down = new PrivateArchiveQueryService(deps({
      storyChunks: { listQueryChunks: vi.fn(async () => stories) },
      runtime: { ensureEmbeddingRuntime: vi.fn(async () => false), ensureGenerationRuntime: vi.fn(async () => true) },
    }))
    await expect(down.findStorySections(7, 'Hi')).rejects.toMatchObject({ code: 'private-ai-unavailable' })
  })
})

describe('findStorySections citations', () => {
  it('cites nothing when the reply did not use any memory', async () => {
    const service = new PrivateArchiveQueryService(deps({
      storyChunks: { listQueryChunks: vi.fn(async () => [storyChunk(2, 'childhood', 'Life Story', 'Where I grew up', 'We lived by Lake Victoria in Entebbe.', [1, 0])]) },
    }))
    const found = await service.findStorySections(7, 'Tell me about home')
    expect(found.sections).toHaveLength(1)
    expect(found.cite('How are you feeling today?')).toEqual([])
  })
})

describe('findStorySections with one memory', () => {
  const only = [storyChunk(2, 'childhood', 'Life Story', 'Where I grew up', 'I grew up in Entebbe by Lake Victoria. My father took us fishing at dawn and my mother sold mandazi.', [1, 0])]

  it('cites the memory when the reply uses two of its words the person did not say', async () => {
    const service = new PrivateArchiveQueryService(deps({ storyChunks: { listQueryChunks: vi.fn(async () => only) } }))
    const found = await service.findStorySections(7, 'Tell me about where I grew up')
    expect(found.cite('I am thinking of the fishing and mandazi stories from your childhood.')).toHaveLength(1)
  })

  it('does not count words echoed from the message, or a single shared word', async () => {
    const service = new PrivateArchiveQueryService(deps({ storyChunks: { listQueryChunks: vi.fn(async () => only) } }))
    const found = await service.findStorySections(7, 'Tell me about where I grew up')
    expect(found.cite('You want to know where you grew up. How are you feeling?')).toEqual([])
    expect(found.cite('Fishing sounds lovely. How are you today?')).toEqual([])
  })
})

describe('PrivateArchiveQueryService general questions', () => {
  function withGeneral(generateGeneral: (question: string, languageLabel?: string) => Promise<string>, overrides: Partial<PrivateArchiveQueryServiceDependencies> = {}) {
    const base = deps(overrides)
    return { ...base, qwen: { ...base.qwen, generateFast: vi.fn(async () => 'NOT_FOUND'), generateGeneral: vi.fn(generateGeneral) } }
  }

  it('answers from general knowledge, with no sources, when the private sources do not answer', async () => {
    const dependencies = withGeneral(async () => 'The capital of Uganda is Kampala.')
    const service = new PrivateArchiveQueryService(dependencies)

    await expect(service.ask({ question: 'What is the capital of Uganda?', scope: { type: 'vault', vault: { type: 'all' } }, language: 'fr' }))
      .resolves.toEqual({ answer: 'The capital of Uganda is Kampala.', sources: [], route: 'general' })
    expect(dependencies.qwen.generateGeneral).toHaveBeenCalledWith('What is the capital of Uganda?', 'French')
  })

  it('answers general questions when nothing is indexed yet', async () => {
    const dependencies = withGeneral(async () => 'It is 16:09.', {
      vaultChunks: { listQueryChunks: vi.fn(async () => []) },
      storyChunks: { listQueryChunks: vi.fn(async () => []) },
    })
    const service = new PrivateArchiveQueryService(dependencies)

    await expect(service.ask({ question: 'What time is it?', scope: { type: 'combined', vault: { type: 'all' } } }))
      .resolves.toEqual({ answer: 'It is 16:09.', sources: [], route: 'general' })
    expect(dependencies.nomic.embedQuery).not.toHaveBeenCalled()
  })

  it('keeps the private not-found answer when general knowledge does not know either', async () => {
    // Real Granite 4.0 1B replies to family questions with no private source.
    for (const reply of ['NOT_FOUND', 'I do not know.', 'I do not have enough information about this person or their documents to determine what the will said.']) {
      const service = new PrivateArchiveQueryService(withGeneral(async () => reply))
      await expect(service.ask({ question: "What is Ruth's blood type?", scope: { type: 'vault', vault: { type: 'all' } } }))
        .resolves.toMatchObject({ answer: 'I could not find it in the selected Vault documents.', sources: [] })
    }
  })

  it('keeps a worded not-found reply when general knowledge does not know either', async () => {
    const reply = 'There is no information about the car Joseph drives.'
    const base = withGeneral(async () => 'NOT_FOUND')
    const service = new PrivateArchiveQueryService({ ...base, qwen: { ...base.qwen, generateFast: vi.fn(async () => reply) } })
    await expect(service.ask({ question: 'What car does Joseph drive?', scope: { type: 'vault', vault: { type: 'all' } } }))
      .resolves.toMatchObject({ answer: reply, sources: [] })
  })

  it('falls back to the not-found answer instead of failing when the general answer fails', async () => {
    const service = new PrivateArchiveQueryService(withGeneral(async () => { throw new Error('offline') }))
    await expect(service.ask({ question: 'Who is the president of France?', scope: { type: 'story' } }))
      .resolves.toMatchObject({ answer: 'I could not find it in your confirmed My Story memories.', sources: [] })

    const noRuntime = new PrivateArchiveQueryService(withGeneral(async () => 'unused', {
      vaultChunks: { listQueryChunks: vi.fn(async () => []) },
      runtime: { ensureEmbeddingRuntime: vi.fn(async () => true), ensureGenerationRuntime: vi.fn(async () => false) },
    }))
    await expect(noRuntime.ask({ question: 'What time is it?', scope: { type: 'vault', vault: { type: 'all' } } }))
      .resolves.toMatchObject({ answer: 'I could not find it in the selected Vault documents.', sources: [] })
  })
})

describe('PrivateArchiveQueryService answers that use no private section', () => {
  // Two sources in scope, so a word found in only one of them tells which one an answer used.
  const twoSources = {
    vaultChunks: { listQueryChunks: vi.fn(async () => [vaultChunk(1, 'meeting.pdf', 0, 'We shipped two releases and the Vault keeps documents private.', [1, 0])]) },
    storyChunks: { listQueryChunks: vi.fn(async () => [storyChunk(2, 'childhood', 'Life Story', 'Childhood and early memories', 'I grew up near Jinja.', [0.9, 0.1])]) },
  }
  function service(grounded: string, general: string, overrides: Partial<PrivateArchiveQueryServiceDependencies> = twoSources) {
    const base = deps(overrides)
    const qwen = { ...base.qwen, generateFast: vi.fn(async () => grounded), generateGeneral: vi.fn(async () => general) }
    return { qwen, service: new PrivateArchiveQueryService({ ...base, qwen }) }
  }
  const combined = { type: 'combined' as const, vault: { type: 'all' as const } }

  it('asks a general question again without the unrelated sections, so it lists none of them', async () => {
    // Real Granite 4.0 1B answers: with family sections in front of it, it said "Kigali".
    const { qwen, service: archive } = service('The capital of Uganda is Kigali.', 'The capital of Uganda is Kampala.')
    await expect(archive.ask({ question: 'What is the capital of Uganda?', scope: combined }))
      .resolves.toEqual({ answer: 'The capital of Uganda is Kampala.', sources: [], route: 'general' })
    expect(qwen.generateGeneral).toHaveBeenCalledWith('What is the capital of Uganda?', undefined)
  })

  it('does not show a family fact the model made up', async () => {
    const { service: archive } = service('The spare house key is stored with the family papers, which never leave home.', 'NOT_FOUND')
    await expect(archive.ask({ question: 'Where is the spare house key?', scope: combined }))
      .resolves.toEqual({ answer: 'I could not find it in the selected My Story and Vault sources.', sources: [], route: 'fast' })
  })

  it('keeps answers that use a private section', async () => {
    const { qwen, service: archive } = service('You grew up near Jinja.', 'unused')
    const result = await archive.ask({ question: 'Where did I grow up?', scope: combined })
    expect(result.answer).toBe('You grew up near Jinja.')
    expect(result.sources.map((source) => source.fileName)).toEqual(['My Story › Life Story › Childhood and early memories'])
    expect(qwen.generateGeneral).not.toHaveBeenCalled()
  })

  it('keeps the answer and its sources when it cannot be traced: one source in scope, or another language', async () => {
    const single = service('Yes, she was.', 'unused', { ...twoSources, storyChunks: { listQueryChunks: vi.fn(async () => []) } })
    const one = await single.service.ask({ question: 'Was she born there?', scope: { type: 'vault', vault: { type: 'all' } } })
    expect(one).toMatchObject({ answer: 'Yes, she was.', route: 'fast' })
    expect(one.sources).toHaveLength(1)

    const french = service('Oui, elle y est née.', 'unused')
    const translated = await french.service.ask({ question: 'Est-elle née là-bas ?', scope: combined, language: 'fr' })
    expect(translated.answer).toBe('Oui, elle y est née.')
    expect(translated.sources).toHaveLength(2)
    expect(french.qwen.generateGeneral).not.toHaveBeenCalled()
  })
})

describe('PrivateArchiveQueryService clock questions', () => {
  function setup() {
    const base = deps()
    const qwen = { ...base.qwen, generateGeneral: vi.fn(async () => 'It is Thursday, 5 November 2026.') }
    return { dependencies: { ...base, qwen }, service: new PrivateArchiveQueryService({ ...base, qwen }) }
  }

  it('answers the time, date and day from the clock without searching private sources', async () => {
    for (const question of ['What time is it?', "what's the time now", 'What is the date today?', "What is today's date?", 'What day is it today?', 'Can you tell me what day of the week it is?', 'What year is it?', 'Current date']) {
      const { dependencies, service } = setup()
      await expect(service.ask({ question, scope: { type: 'combined', vault: { type: 'all' } } }))
        .resolves.toEqual({ answer: 'It is Thursday, 5 November 2026.', sources: [], route: 'general' })
      expect(dependencies.nomic.embedQuery).not.toHaveBeenCalled()
      expect(dependencies.vaultChunks.listQueryChunks).not.toHaveBeenCalled()
    }
  })

  it('still searches private sources for dates and days in the family', async () => {
    for (const question of ['What is the date of the wedding?', "What day is Ruth's check-up?", 'What time does Ruth take her eye drops?']) {
      const { dependencies, service } = setup()
      await service.ask({ question, scope: { type: 'vault', vault: { type: 'all' } } })
      expect(dependencies.nomic.embedQuery).toHaveBeenCalled()
    }
  })
})

describe('PrivateArchiveQueryService review fixes', () => {
  it('keeps a grounded answer when the sections in scope say the same thing (no word is rare)', async () => {
    const base = deps({
      vaultChunks: { listQueryChunks: vi.fn(async () => [vaultChunk(1, 'letter.txt', 0, 'Ruth lives in Jinja.', [1, 0]), vaultChunk(2, 'notes.txt', 0, 'Ruth lives in Jinja.', [0.9, 0.1])]) },
    })
    const qwen = { ...base.qwen, generateFast: vi.fn(async () => 'Ruth lives in Jinja.'), generateGeneral: vi.fn(async () => 'NOT_FOUND') }
    const result = await new PrivateArchiveQueryService({ ...base, qwen }).ask({ question: 'Where does Ruth live?', scope: { type: 'vault', vault: { type: 'all' } } })
    expect(result.answer).toBe('Ruth lives in Jinja.')
    expect(result.sources.map((source) => source.fileName)).toEqual(['letter.txt', 'notes.txt'])
    expect(qwen.generateGeneral).not.toHaveBeenCalled()
  })

  it('recognises a general refusal in every supported language', async () => {
    const refusals: Array<[string, string]> = [
      ['fr', 'Je ne sais pas.'], ['es', 'No lo sé.'], ['pt', 'Não sei.'], ['zh', '我不知道。'], ['ja', 'わかりません。'], ['fil', 'Hindi ko alam.'],
    ]
    for (const [language, reply] of refusals) {
      const base = deps({ vaultChunks: { listQueryChunks: vi.fn(async () => []) } })
      const qwen = { ...base.qwen, generateGeneral: vi.fn(async () => reply) }
      const result = await new PrivateArchiveQueryService({ ...base, qwen }).ask({ question: '?', scope: { type: 'vault', vault: { type: 'all' } }, language })
      expect(result.route, `${language}: ${reply}`).not.toBe('general')
      expect(result.sources).toEqual([])
    }
  })
})

describe('PrivateArchiveQueryService calculated answers', () => {
  function ask(sectionText: string, grounded: string, question: string) {
    const base = deps({
      vaultChunks: { listQueryChunks: vi.fn(async () => [vaultChunk(1, 'ruth.txt', 0, sectionText, [1, 0])]) },
    })
    const qwen = { ...base.qwen, generateFast: vi.fn(async () => grounded), generateGeneral: vi.fn(async () => 'NOT_FOUND') }
    return { qwen, result: new PrivateArchiveQueryService({ ...base, qwen }).ask({ question, scope: { type: 'combined', vault: { type: 'all' } } }) }
  }

  it('keeps an age or a count worked out from a date in the sections (Codex review on #75)', async () => {
    const { qwen, result } = ask('Ruth was born on 1 January 1950.', 'Ruth is 76 years old.', 'How old is Ruth?')
    await expect(result).resolves.toMatchObject({ answer: 'Ruth is 76 years old.', route: 'fast' })
    expect(qwen.generateGeneral).not.toHaveBeenCalled()
  })

  it('still asks the general way when the answer has a number but the sections have none', async () => {
    const { qwen, result } = ask('Ruth likes tea with her neighbours.', 'Uganda became independent in 1962.', 'When did Uganda become independent?')
    await result
    expect(qwen.generateGeneral).toHaveBeenCalledWith('When did Uganda become independent?', undefined)
  })
})

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DocumentExtractor } from './DocumentExtractor'

const temporaryDirectories: string[] = []

async function tempFile(name: string, content: string | Buffer): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'family-circle-extractor-'))
  temporaryDirectories.push(directory)
  const filePath = join(directory, name)
  await writeFile(filePath, content)
  return filePath
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('DocumentExtractor', () => {
  it('extracts UTF-8 txt', async () => {
    const filePath = await tempFile('history.txt', 'Jajja kept these letters.\nThey belong to our family.')
    const extractor = new DocumentExtractor()

    await expect(extractor.extract(filePath, 'txt')).resolves.toMatchObject({
      extractedText: 'Jajja kept these letters.\nThey belong to our family.',
      wordCount: 9,
      preview: 'Jajja kept these letters. They belong to our family.',
    })
  })

  it('computes word count and a normalized <=240-char preview without rewriting stored text', async () => {
    const originalText = `  ${'family '.repeat(60)}\nprivate\tarchive  `
    const filePath = await tempFile('long.txt', originalText)
    const extractor = new DocumentExtractor()

    const result = await extractor.extract(filePath, 'txt')
    expect(result.extractedText).toBe(originalText.trim())
    expect(result.wordCount).toBe(62)
    expect(result.preview.length).toBeLessThanOrEqual(240)
    expect(result.preview).not.toMatch(/\s{2,}|\n|\t/)
  })

  it('uses mammoth raw-text extraction for docx', async () => {
    const filePath = await tempFile('history.docx', Buffer.from([0x50, 0x4b, 0x03, 0x04]))
    const extractDocxRawText = vi.fn(async (buffer: Buffer) => {
      expect(Buffer.isBuffer(buffer)).toBe(true)
      return { value: 'Grandmother wrote this down.' }
    })
    const extractor = new DocumentExtractor({ extractDocxRawText })

    await expect(extractor.extract(filePath, 'docx')).resolves.toMatchObject({
      extractedText: 'Grandmother wrote this down.',
      wordCount: 4,
    })
    expect(extractDocxRawText).toHaveBeenCalledTimes(1)
  })

  it('uses PDF getText and always destroys the parser', async () => {
    const filePath = await tempFile('history.pdf', Buffer.from('%PDF-1.7'))
    const getText = vi.fn(async () => ({ text: 'A scanned-looking but text PDF.' }))
    const destroy = vi.fn(async () => undefined)
    const createPdfParser = vi.fn(() => ({ getText, destroy }))
    const extractor = new DocumentExtractor({ createPdfParser })

    await expect(extractor.extract(filePath, 'pdf')).resolves.toMatchObject({
      extractedText: 'A scanned-looking but text PDF.',
      wordCount: 6,
    })
    expect(createPdfParser).toHaveBeenCalledTimes(1)
    expect(getText).toHaveBeenCalledTimes(1)
    expect(destroy).toHaveBeenCalledTimes(1)
  })

  it('destroys the PDF parser and maps parser failures to extraction-failed', async () => {
    const filePath = await tempFile('broken.pdf', Buffer.from('%PDF-1.7'))
    const destroy = vi.fn(async () => undefined)
    const extractor = new DocumentExtractor({
      createPdfParser: () => ({
        getText: async () => { throw new Error('parser detail must stay internal') },
        destroy,
      }),
    })

    await expect(extractor.extract(filePath, 'pdf')).rejects.toMatchObject({ code: 'extraction-failed' })
    expect(destroy).toHaveBeenCalledTimes(1)
  })

  it('maps empty extraction to extraction-failed', async () => {
    const filePath = await tempFile('empty.txt', '   \n\t  ')
    const extractor = new DocumentExtractor()

    await expect(extractor.extract(filePath, 'txt')).rejects.toMatchObject({ code: 'extraction-failed' })
  })
})

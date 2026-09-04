import { readFile } from 'node:fs/promises'
import mammoth from 'mammoth'
import { PDFParse } from 'pdf-parse'
import type { VaultFileType } from './vaultModels'

interface PdfParserPort {
  getText(): Promise<{ text: string }>
  destroy(): Promise<void> | void
}

interface DocumentExtractorDependencies {
  extractDocxRawText?: (buffer: Buffer) => Promise<{ value: string }>
  createPdfParser?: (buffer: Buffer) => PdfParserPort
}

export interface ExtractedDocumentText {
  extractedText: string
  wordCount: number
  preview: string
}

export class VaultExtractionError extends Error {
  readonly code = 'extraction-failed' as const

  constructor() {
    super('Document text extraction failed')
    this.name = 'VaultExtractionError'
  }
}

function normalizeForPreview(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function countWords(text: string): number {
  const normalized = normalizeForPreview(text)
  return normalized ? normalized.split(' ').length : 0
}

export class DocumentExtractor {
  private readonly extractDocxRawText: (buffer: Buffer) => Promise<{ value: string }>
  private readonly createPdfParser: (buffer: Buffer) => PdfParserPort

  constructor(dependencies: DocumentExtractorDependencies = {}) {
    this.extractDocxRawText = dependencies.extractDocxRawText
      ?? ((buffer) => mammoth.extractRawText({ buffer }))
    this.createPdfParser = dependencies.createPdfParser
      ?? ((buffer) => new PDFParse({ data: buffer }))
  }

  async extract(filePath: string, fileType: VaultFileType): Promise<ExtractedDocumentText> {
    try {
      let rawText: string
      if (fileType === 'txt') {
        rawText = await readFile(filePath, 'utf8')
      } else if (fileType === 'docx') {
        const buffer = await readFile(filePath)
        rawText = (await this.extractDocxRawText(buffer)).value
      } else {
        const parser = this.createPdfParser(await readFile(filePath))
        try {
          rawText = (await parser.getText()).text
        } finally {
          await parser.destroy()
        }
      }

      const extractedText = rawText.trim()
      if (!extractedText) throw new VaultExtractionError()

      return {
        extractedText,
        wordCount: countWords(extractedText),
        preview: normalizeForPreview(extractedText).slice(0, 240),
      }
    } catch (error) {
      if (error instanceof VaultExtractionError) throw error
      throw new VaultExtractionError()
    }
  }
}

import { describe, expect, it } from 'bun:test'
import { classifyFile, FILE_EXTENSIONS_PATTERN } from '../lib/file-classification'

describe('file preview classification', () => {
  it('derives native preview policy from the shared format registry', () => {
    expect(classifyFile('/work/photo.png')).toEqual({ type: 'image', canPreview: true })
    expect(classifyFile('/work/readme.md')).toEqual({ type: 'markdown', canPreview: true })
    expect(classifyFile('/work/source.ts')).toEqual({ type: 'code', canPreview: true })
    expect(classifyFile('/work/data.csv')).toEqual({ type: 'text', canPreview: true })
  })

  it('keeps Office, archives and unknown binaries on the external fallback path', () => {
    expect(classifyFile('/work/report.docx')).toEqual({ type: null, canPreview: false })
    expect(classifyFile('/work/archive.zip')).toEqual({ type: null, canPreview: false })
    expect(classifyFile('/work/payload.vendorbin')).toEqual({ type: null, canPreview: false })
  })

  it('can preview an extensionless managed revision from its trusted MIME metadata', () => {
    expect(classifyFile('/work/revision', 'image/png')).toEqual({ type: 'image', canPreview: true })
    expect(classifyFile('/work/revision', 'application/octet-stream')).toEqual({ type: null, canPreview: false })
  })

  it('keeps link detection aligned with all registered extensions', () => {
    expect(new RegExp(`\\.(${FILE_EXTENSIONS_PATTERN})$`, 'i').test('report.odt')).toBe(true)
    expect(new RegExp(`\\.(${FILE_EXTENSIONS_PATTERN})$`, 'i').test('audio.m4a')).toBe(true)
  })
})

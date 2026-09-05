import { describe, expect, it } from 'bun:test';
import {
  FILE_FORMAT_REGISTRY,
  getRegisteredExtension,
  registeredFileExtensions,
  resolveFileFormat,
} from '../file-formats.ts';

describe('Artifact file format registry', () => {
  it('resolves semantic Artifact and preview policies from one registry', () => {
    expect(resolveFileFormat('/work/report.docx')).toMatchObject({
      artifactKind: 'document',
      preview: 'office-markdown',
      validation: 'ooxml',
      safeText: false,
    });
    expect(resolveFileFormat('/work/data.csv')).toMatchObject({
      artifactKind: 'spreadsheet',
      preview: 'text',
      safeText: true,
    });
    expect(resolveFileFormat('/work/photo.avif')).toMatchObject({
      artifactKind: 'image',
      preview: 'image',
    });
  });

  it('fails unknown formats closed instead of treating binary content as text', () => {
    expect(resolveFileFormat('/work/model.custom-binary')).toMatchObject({
      id: 'unknown',
      artifactKind: 'file',
      mimeType: 'application/octet-stream',
      preview: 'external',
      safeText: false,
    });
  });

  it('uses explicit canonical MIME when an extension is absent', () => {
    expect(resolveFileFormat('/work/no-extension', 'image/png')).toMatchObject({
      id: 'png',
      artifactKind: 'image',
    });
  });

  it.each(['xlsx', 'xlsm', 'xls', 'ods', 'docx', 'doc', 'odt', 'pptx', 'ppt', 'odp'])(
    'uses Office preview policy for %s by extension or canonical MIME', (extension) => {
      const format = resolveFileFormat(`/work/REPORT.${extension.toUpperCase()}`);
      expect(format.preview).toBe('office-markdown');
      expect(resolveFileFormat('/work/no-extension', format.mimeType).preview).toBe('office-markdown');
    },
  );

  it('supports compound and dotfile suffixes and has no duplicate extension owners', () => {
    expect(getRegisteredExtension('/work/.env.local')).toBe('env.local');
    const registered = registeredFileExtensions();
    const declared = FILE_FORMAT_REGISTRY.flatMap(({ extensions }) => extensions);
    expect(declared.length).toBe(new Set(declared).size);
    expect(registered).toHaveLength(declared.length);
  });
});

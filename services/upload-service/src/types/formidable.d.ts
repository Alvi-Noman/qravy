declare module 'formidable' {
  import type { IncomingMessage } from 'http';

  export type Fields = Record<string, any>;
  export interface FileItem {
    filepath: string;
    originalFilename?: string;
    mimetype?: string;
    size?: number;
  }
  export type Files = Record<string, FileItem[]>;

  export interface FormidableOptions {
    multiples?: boolean;
    maxFileSize?: number;
    allowEmptyFiles?: boolean;
  }

  export interface Formidable {
    parse(req: IncomingMessage): Promise<[Fields, Files]>;
  }

  export default function formidable(options?: FormidableOptions): Formidable;
}
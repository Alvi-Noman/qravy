export function createFile(name: string, type = 'text/plain', content = 'hello') {
  return new File([content], name, { type });
}

export function createDataTransfer(files: File[]) {
  const dt = new DataTransfer();
  files.forEach((f) => dt.items.add(f));
  return dt;
}
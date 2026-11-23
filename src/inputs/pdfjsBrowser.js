/**
 * Loads pdf.js on first use, so the ~1 MB library is only downloaded when
 * someone actually uploads a PDF.
 */
let pdfjsPromise = null

export function loadPdfjs() {
  pdfjsPromise ??= Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
  ]).then(([pdfjs, worker]) => {
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default
    return pdfjs
  })
  return pdfjsPromise
}

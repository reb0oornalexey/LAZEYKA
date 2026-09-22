import jsQR from 'jsqr'

/**
 * Decodes a QR code from a base64 Data URL (e.g. from screen capture, file, or clipboard).
 */
export async function decodeQrFromDataUrl(dataUrl: string): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      try {
        const width = img.naturalWidth || img.width
        const height = img.naturalHeight || img.height

        if (width === 0 || height === 0) {
          return resolve(null)
        }

        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          return resolve(null)
        }

        ctx.drawImage(img, 0, 0)
        const imgData = ctx.getImageData(0, 0, width, height)
        const code = jsQR(imgData.data, width, height, {
          inversionAttempts: 'attemptBoth'
        })

        if (code && code.data && code.data.trim()) {
          resolve(code.data.trim())
        } else {
          resolve(null)
        }
      } catch (err) {
        reject(err)
      }
    }
    img.onerror = () => {
      resolve(null)
    }
    img.src = dataUrl
  })
}

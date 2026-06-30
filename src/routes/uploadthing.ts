import { createRouteHandler, createUploadthing } from 'uploadthing/express'
import type { FileRouter } from 'uploadthing/express'

const f = createUploadthing()

const fileRouter = {
  resumeUploader: f({
    pdf: { maxFileSize: '8MB', maxFileCount: 1 },
  })
    .middleware(async () => ({}))
    .onUploadComplete(async ({ file }) => {
      return { fileUrl: file.ufsUrl }
    }),
} satisfies FileRouter

export type OurFileRouter = typeof fileRouter

const uploadRouter = createRouteHandler({ router: fileRouter })

export default uploadRouter

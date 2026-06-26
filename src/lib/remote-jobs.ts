import { db } from "./db"

const CACHE_KEY = "remote-jobs"

export interface RemoteJobRaw {
  id: number
  url: string
  jobSlug: string
  jobTitle: string
  companyName: string
  companyLogo: string
  jobIndustry: string[]
  jobType: string[]
  jobGeo: string
  jobLevel: string
  jobExcerpt: string
  jobDescription: string
}

interface JobResponse {
  id: number
  title: string
  slug: string
  description: string
  jobType: string
  experienceLevel: string
  workMode: string
  location: string
  city: string
  remoteWork: boolean
  salaryMin: number | null
  salaryMax: number | null
  salaryCurrency: string
  applicationsCount: number
  publishedAt: string
  company: { companyName: string; companyLogo: string | null; city: string | null }
  skills: string[]
  source: string
}

function toSlug(str: string): string {
  return str
    .toLowerCase()
    .replace(/[–—]/g, "-")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
}

function parseJobType(types: string[]): string {
  const map: Record<string, string> = {
    "full-time": "FULL_TIME",
    "part-time": "PART_TIME",
    contract: "CONTRACT",
    internship: "INTERNSHIP",
    temporary: "TEMPORARY",
    freelance: "FREELANCE",
  }
  for (const t of types) {
    const mapped = map[t.toLowerCase()]
    if (mapped) return mapped
  }
  return "FULL_TIME"
}

function parseExperienceLevel(level: string): string {
  const map: Record<string, string> = {
    entry: "ENTRY",
    junior: "JUNIOR",
    midweight: "MID",
    mid: "MID",
    senior: "SENIOR",
    lead: "LEAD",
    executive: "EXECUTIVE",
    director: "EXECUTIVE",
  }
  return map[level.toLowerCase()] || "MID"
}

export async function getRemoteJobsFromCache(): Promise<RemoteJobRaw[]> {
  try {
    const entry = await db.cacheEntry.findUnique({ where: { key: CACHE_KEY } })
    if (!entry) return []
    const raw = entry.data as any
    return raw.data || raw
  } catch {
    return []
  }
}

export function convertRemoteJob(job: RemoteJobRaw): JobResponse {
  const slug = `jobicy-${toSlug(job.jobTitle)}-${job.id}`
  return {
    id: job.id,
    title: job.jobTitle,
    slug,
    description: job.jobDescription?.replace(/<[^>]+>/g, "") || job.jobExcerpt || "",
    jobType: parseJobType(job.jobType || []),
    experienceLevel: parseExperienceLevel(job.jobLevel || ""),
    workMode: "REMOTE",
    location: job.jobGeo || "Remote",
    city: job.jobGeo || "",
    remoteWork: true,
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: "USD",
    applicationsCount: 0,
    publishedAt: new Date().toISOString(),
    company: {
      companyName: job.companyName || "Remote Company",
      companyLogo: job.companyLogo || null,
      city: job.jobGeo || null,
    },
    skills: job.jobIndustry || [],
    source: "jobicy",
  }
}

export async function getAllRemoteJobs(): Promise<JobResponse[]> {
  const raw = await getRemoteJobsFromCache()
  return raw.map(convertRemoteJob)
}

export async function findRemoteJobBySlug(slug: string): Promise<JobResponse | null> {
  const raw = await getRemoteJobsFromCache()
  for (const job of raw) {
    const converted = convertRemoteJob(job)
    if (converted.slug === slug) return converted
  }
  return null
}

export async function findRemoteJobById(id: number): Promise<JobResponse | null> {
  const raw = await getRemoteJobsFromCache()
  const job = raw.find((j) => j.id === id)
  return job ? convertRemoteJob(job) : null
}

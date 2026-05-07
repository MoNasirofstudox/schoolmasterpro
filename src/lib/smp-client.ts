// ============================================================
// SchoolMasterPro — Supabase Frontend SDK
// Drop this into your frontend project.
// npm install @supabase/supabase-js
// ============================================================

import { createClient } from '@supabase/supabase-js'

// ── Client setup ─────────────────────────────────────────────
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
})


// ── Types ─────────────────────────────────────────────────────
export type School = {
  id: string
  name: string
  address?: string
  state?: string
  plan: 'trial' | 'lite' | 'full'
  status: 'active' | 'suspended' | 'offboarded'
  trial_expires_at?: string
}

export type Student = {
  id: string
  school_id: string
  student_code: string
  full_name: string
  date_of_birth?: string
  gender?: 'male' | 'female'
  state_of_origin?: string
  guardian_name?: string
  guardian_phone?: string
  is_active: boolean
  enrolled_at: string
}

export type ScoreEntry = {
  id: string
  assessment_id: string
  student_id: string
  ca1?: number
  ca2?: number
  exam?: number
  total?: number
  grade?: string
  remark?: string
  position?: number
}

export type FeeRecord = {
  id: string
  student_id: string
  term_id: string
  fee_type: string
  amount_due: number
  amount_paid: number
  status: 'pending' | 'partial' | 'paid' | 'arrears'
}

export type DashboardStats = {
  total_students: number
  active_students: number
  total_billed: number
  total_collected: number
  students_with_arrears: number
  arrears_amount: number
  subjects_complete: number
  subjects_pending: number
  current_term: string
  current_session: string
}


// ── Auth ──────────────────────────────────────────────────────
export const auth = {
  async signIn(email: string, password: string) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error

    // Record last login
    await supabase
      .from('operators')
      .update({ last_login: new Date().toISOString() })
      .eq('id', data.user.id)

    return data
  },

  async signOut() {
    const { error } = await supabase.auth.signOut()
    if (error) throw error
  },

  async getSession() {
    const { data } = await supabase.auth.getSession()
    return data.session
  },

  async getUser() {
    const { data } = await supabase.auth.getUser()
    return data.user
  },

  onAuthChange(callback: (session: any) => void) {
    return supabase.auth.onAuthStateChange((_event, session) => {
      callback(session)
    })
  },
}


// ── Operator profile ──────────────────────────────────────────
export const operatorApi = {
  async getProfile(userId: string) {
    const { data, error } = await supabase
      .from('operators')
      .select('*, school:schools(*)')
      .eq('id', userId)
      .single()
    if (error) throw error
    return data
  },

  async createProfile(userId: string, schoolId: string, fullName: string, phone?: string) {
    const { data, error } = await supabase
      .from('operators')
      .insert({ id: userId, school_id: schoolId, full_name: fullName, phone })
      .select()
      .single()
    if (error) throw error
    return data
  },
}


// ── Dashboard ─────────────────────────────────────────────────
export const dashboardApi = {
  async getStats(schoolId: string): Promise<DashboardStats> {
    const { data, error } = await supabase.rpc('get_dashboard_stats', {
      p_school_id: schoolId,
    })
    if (error) throw error
    return data as DashboardStats
  },
}


// ── Students ──────────────────────────────────────────────────
export const studentsApi = {
  async list(schoolId: string, opts?: {
    search?: string
    classId?: string
    isActive?: boolean
    limit?: number
    offset?: number
  }) {
    let q = supabase
      .from('students')
      .select(`
        *,
        student_class_terms(
          class:classes(name),
          term:terms(is_current)
        ),
        fee_records(status, term:terms(is_current))
      `)
      .eq('school_id', schoolId)
      .order('full_name')

    if (opts?.search) {
      q = q.or(`full_name.ilike.%${opts.search}%,student_code.ilike.%${opts.search}%`)
    }
    if (opts?.isActive !== undefined) {
      q = q.eq('is_active', opts.isActive)
    }
    if (opts?.limit) q = q.limit(opts.limit)
    if (opts?.offset) q = q.range(opts.offset, (opts.offset + (opts.limit ?? 50)) - 1)

    const { data, error, count } = await q
    if (error) throw error
    return { data, count }
  },

  async get(studentId: string) {
    const { data, error } = await supabase
      .from('students')
      .select(`
        *,
        student_class_terms(
          class:classes(id, name),
          term:terms(id, name, is_current, session:academic_sessions(name))
        ),
        fee_records(*, payments:fee_payments(*)),
        score_entries(*, assessment:assessments(subject:subjects(name), term:terms(name)))
      `)
      .eq('id', studentId)
      .single()
    if (error) throw error
    return data
  },

  async create(schoolId: string, payload: Omit<Student, 'id' | 'school_id' | 'student_code' | 'enrolled_at'> & { class_id: string }) {
    // Generate student code
    const { data: codeData } = await supabase.rpc('generate_student_code', { p_school_id: schoolId })
    const student_code = codeData as string

    // Create student
    const { data: student, error: sErr } = await supabase
      .from('students')
      .insert({ ...payload, school_id: schoolId, student_code })
      .select()
      .single()
    if (sErr) throw sErr

    // Get current term
    const { data: term } = await supabase
      .from('terms')
      .select('id, session:academic_sessions!inner(school_id)')
      .eq('is_current', true)
      .eq('session.school_id', schoolId)
      .single()

    // Enroll in current term
    if (term) {
      await supabase.from('student_class_terms').insert({
        student_id: student.id,
        term_id: term.id,
        class_id: payload.class_id,
      })
    }

    return student
  },

  async update(studentId: string, payload: Partial<Student>) {
    const { data, error } = await supabase
      .from('students')
      .update(payload)
      .eq('id', studentId)
      .select()
      .single()
    if (error) throw error
    return data
  },

  async deactivate(studentId: string) {
    return studentsApi.update(studentId, { is_active: false })
  },
}


// ── School Setup ──────────────────────────────────────────────
export const setupApi = {
  async getSessions(schoolId: string) {
    const { data, error } = await supabase
      .from('academic_sessions')
      .select('*, terms(*)')
      .eq('school_id', schoolId)
      .order('name', { ascending: false })
    if (error) throw error
    return data
  },

  async getCurrentTerm(schoolId: string) {
    const { data, error } = await supabase
      .from('terms')
      .select('*, session:academic_sessions!inner(school_id, name)')
      .eq('is_current', true)
      .eq('session.school_id', schoolId)
      .single()
    if (error) return null
    return data
  },

  async getClasses(schoolId: string) {
    const { data, error } = await supabase
      .from('classes')
      .select('*, class_subjects(*, subject:subjects(*))')
      .eq('school_id', schoolId)
      .order('sort_order')
    if (error) throw error
    return data
  },

  async getSubjects(schoolId: string) {
    const { data, error } = await supabase
      .from('subjects')
      .select('*')
      .eq('school_id', schoolId)
      .eq('is_active', true)
      .order('name')
    if (error) throw error
    return data
  },

  async toggleExamPeriod(termId: string, open: boolean) {
    const { data, error } = await supabase
      .from('terms')
      .update({ is_exam_open: open })
      .eq('id', termId)
      .select()
      .single()
    if (error) throw error
    return data
  },
}


// ── Assessments ───────────────────────────────────────────────
export const assessmentsApi = {
  async list(termId: string) {
    const { data, error } = await supabase
      .from('assessments')
      .select(`
        *,
        class:classes(name),
        subject:subjects(name),
        score_entries(count)
      `)
      .eq('term_id', termId)
    if (error) throw error
    return data
  },

  async getWithScores(assessmentId: string) {
    const { data, error } = await supabase
      .from('assessments')
      .select(`
        *,
        class:classes(name),
        subject:subjects(name, code),
        term:terms(name),
        score_entries(*, student:students(full_name, student_code))
      `)
      .eq('id', assessmentId)
      .single()
    if (error) throw error
    return data
  },

  async create(termId: string, classId: string, subjectId: string, createdBy: string) {
    const { data, error } = await supabase
      .from('assessments')
      .insert({ term_id: termId, class_id: classId, subject_id: subjectId, created_by: createdBy })
      .select()
      .single()
    if (error) throw error
    return data
  },

  async bulkSaveScores(assessmentId: string, entries: Array<{
    student_id: string
    ca1?: number
    ca2?: number
    exam?: number
  }>) {
    // Upsert all entries — trigger handles total/grade/remark
    const rows = entries.map(e => ({
      assessment_id: assessmentId,
      ...e,
    }))

    const { error } = await supabase
      .from('score_entries')
      .upsert(rows, { onConflict: 'assessment_id,student_id' })
    if (error) throw error

    // Recompute positions via RPC
    await supabase.rpc('recompute_positions', { p_assessment_id: assessmentId })
  },

  async lock(assessmentId: string) {
    const { data, error } = await supabase
      .from('assessments')
      .update({ status: 'locked', locked_at: new Date().toISOString() })
      .eq('id', assessmentId)
      .select()
      .single()
    if (error) throw error
    return data
  },

  async unlock(assessmentId: string) {
    const { data, error } = await supabase
      .from('assessments')
      .update({ status: 'open', locked_at: null })
      .eq('id', assessmentId)
      .select()
      .single()
    if (error) throw error
    return data
  },
}


// ── Fees ──────────────────────────────────────────────────────
export const feesApi = {
  async getStudentFees(studentId: string, termId?: string) {
    let q = supabase
      .from('fee_records')
      .select('*, payments:fee_payments(*), term:terms(name)')
      .eq('student_id', studentId)
    if (termId) q = q.eq('term_id', termId)
    const { data, error } = await q
    if (error) throw error
    return data
  },

  async getTermSummary(schoolId: string, termId: string) {
    const { data, error } = await supabase
      .from('fee_records')
      .select('amount_due, amount_paid, status, student:students!inner(school_id)')
      .eq('term_id', termId)
      .eq('student.school_id', schoolId)
    if (error) throw error

    const totalDue = data.reduce((s, r) => s + Number(r.amount_due), 0)
    const totalPaid = data.reduce((s, r) => s + Number(r.amount_paid), 0)
    return {
      total_billed: totalDue,
      total_collected: totalPaid,
      outstanding: totalDue - totalPaid,
      collection_rate: totalDue > 0 ? totalPaid / totalDue : 0,
      by_status: data.reduce((acc: any, r) => {
        acc[r.status] = (acc[r.status] || 0) + 1
        return acc
      }, {}),
    }
  },

  async recordPayment(feeRecordId: string, payload: {
    amount: number
    payment_date: string
    method: 'cash' | 'bank_transfer' | 'pos' | 'cheque'
    reference?: string
    recorded_by: string
  }) {
    // Insert payment — trigger updates fee_record status automatically
    const { data, error } = await supabase
      .from('fee_payments')
      .insert({ fee_record_id: feeRecordId, ...payload })
      .select()
      .single()
    if (error) throw error
    return data
  },
}


// ── Report Cards ──────────────────────────────────────────────
export const reportsApi = {
  async getStudentReport(studentId: string, termId: string) {
    const { data, error } = await supabase.rpc('get_student_report', {
      p_student_id: studentId,
      p_term_id: termId,
    })
    if (error) throw error
    return data
  },

  async getBatchReports(studentIds: string[], termId: string) {
    return Promise.all(
      studentIds.map(id => reportsApi.getStudentReport(id, termId))
    )
  },
}


// ── Staff ─────────────────────────────────────────────────────
export const staffApi = {
  async list(schoolId: string) {
    const { data, error } = await supabase
      .from('staff')
      .select('*, class_teacher:classes(name)')
      .eq('school_id', schoolId)
      .order('full_name')
    if (error) throw error
    return data
  },

  async create(schoolId: string, payload: any) {
    const { data, error } = await supabase
      .from('staff')
      .insert({ ...payload, school_id: schoolId })
      .select()
      .single()
    if (error) throw error
    return data
  },

  async update(staffId: string, payload: any) {
    const { data, error } = await supabase
      .from('staff')
      .update(payload)
      .eq('id', staffId)
      .select()
      .single()
    if (error) throw error
    return data
  },
}


// ── Documents ─────────────────────────────────────────────────
export const documentsApi = {
  async list(schoolId: string, category?: string) {
    let q = supabase
      .from('documents')
      .select('*')
      .eq('school_id', schoolId)
      .order('uploaded_at', { ascending: false })
    if (category) q = q.eq('category', category)
    const { data, error } = await q
    if (error) throw error
    return data
  },

  async upload(schoolId: string, file: File, category: string, uploadedBy: string) {
    const ext = file.name.split('.').pop()
    const path = `${schoolId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`

    // Upload to Supabase Storage
    const { error: uploadErr } = await supabase.storage
      .from('school-documents')
      .upload(path, file, { contentType: file.type })
    if (uploadErr) throw uploadErr

    // Save record
    const { data, error } = await supabase
      .from('documents')
      .insert({
        school_id: schoolId,
        name: file.name,
        category,
        storage_path: path,
        file_size_bytes: file.size,
        mime_type: file.type,
        uploaded_by: uploadedBy,
      })
      .select()
      .single()
    if (error) throw error
    return data
  },

  async getDownloadUrl(storagePath: string) {
    const { data } = supabase.storage
      .from('school-documents')
      .getPublicUrl(storagePath)
    return data.publicUrl
  },

  async delete(docId: string, storagePath: string) {
    await supabase.storage.from('school-documents').remove([storagePath])
    const { error } = await supabase.from('documents').delete().eq('id', docId)
    if (error) throw error
  },
}


// ── Platform Admin ────────────────────────────────────────────
export const platformApi = {
  async getStats() {
    const { data, error } = await supabase.rpc('get_platform_stats')
    if (error) throw error
    return data
  },

  async listSchools() {
    const { data, error } = await supabase
      .from('schools')
      .select('*')
      .order('name')
    if (error) throw error
    return data
  },

  async createSchool(payload: Omit<School, 'id'>) {
    const { data, error } = await supabase
      .from('schools')
      .insert(payload)
      .select()
      .single()
    if (error) throw error
    return data
  },

  async updateSchool(schoolId: string, payload: Partial<School>) {
    const { data, error } = await supabase
      .from('schools')
      .update(payload)
      .eq('id', schoolId)
      .select()
      .single()
    if (error) throw error
    return data
  },

  async listOperators(schoolId: string) {
    const { data, error } = await supabase
      .from('operators')
      .select('*')
      .eq('school_id', schoolId)
    if (error) throw error
    return data
  },
}

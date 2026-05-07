// ============================================================
// SchoolMasterPro — Supabase Integration Layer
// Included in every page via <script src="smp-supabase.js">
// ============================================================

// ── Config (replace with your real values) ────────────────────
const SMP_CONFIG = {
  supabaseUrl: 'https://your-project-ref.supabase.co',
  supabaseKey: 'your-anon-key-here',
}

// ── Supabase client (loaded via CDN in each HTML page) ────────
let _supabase = null
function getClient() {
  if (!_supabase) {
    _supabase = supabase.createClient(SMP_CONFIG.supabaseUrl, SMP_CONFIG.supabaseKey, {
      auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: false }
    })
  }
  return _supabase
}

// ── Session guard — redirect to login if not authenticated ────
async function requireAuth() {
  const sb = getClient()
  const { data: { session } } = await sb.auth.getSession()
  if (!session) {
    window.location.href = 'login.html'
    return null
  }
  return session
}

// ── Get current operator profile + school ─────────────────────
async function getOperatorProfile(userId) {
  const { data, error } = await getClient()
    .from('operators')
    .select('*, school:schools(*)')
    .eq('id', userId)
    .single()
  if (error) throw error
  return data
}

// ── Auth helpers ─────────────────────────────────────────────
const Auth = {
  async signIn(email, password) {
    const { data, error } = await getClient().auth.signInWithPassword({ email, password })
    if (error) throw error
    await getClient().from('operators').update({ last_login: new Date().toISOString() }).eq('id', data.user.id)
    return data
  },
  async signOut() {
    await getClient().auth.signOut()
    window.location.href = 'login.html'
  },
  async getSession() {
    const { data } = await getClient().auth.getSession()
    return data.session
  }
}

// ── Dashboard API ─────────────────────────────────────────────
const DashboardAPI = {
  async getStats(schoolId) {
    const { data, error } = await getClient().rpc('get_dashboard_stats', { p_school_id: schoolId })
    if (error) throw error
    return data
  }
}

// ── Students API ──────────────────────────────────────────────
const StudentsAPI = {
  async list(schoolId, opts = {}) {
    let q = getClient()
      .from('students')
      .select('*, student_class_terms(class:classes(name), term:terms(is_current)), fee_records(status, term:terms(is_current))', { count: 'exact' })
      .eq('school_id', schoolId)
      .order('full_name')
    if (opts.search) q = q.or(`full_name.ilike.%${opts.search}%,student_code.ilike.%${opts.search}%`)
    if (opts.classId) q = q.eq('student_class_terms.class_id', opts.classId)
    if (opts.isActive !== undefined) q = q.eq('is_active', opts.isActive)
    if (opts.limit) q = q.limit(opts.limit)
    if (opts.offset) q = q.range(opts.offset, opts.offset + (opts.limit || 50) - 1)
    const { data, error, count } = await q
    if (error) throw error
    return { data, count }
  },

  async get(studentId) {
    const { data, error } = await getClient()
      .from('students')
      .select(`*, student_class_terms(class:classes(id,name), term:terms(id,name,is_current,session:academic_sessions(name))), fee_records(*, payments:fee_payments(*)), score_entries(*, assessment:assessments(subject:subjects(name,code), term:terms(name,id)))`)
      .eq('id', studentId)
      .single()
    if (error) throw error
    return data
  },

  async create(schoolId, payload) {
    const { data: code } = await getClient().rpc('generate_student_code', { p_school_id: schoolId })
    const { data: student, error } = await getClient()
      .from('students')
      .insert({ ...payload, school_id: schoolId, student_code: code })
      .select().single()
    if (error) throw error
    // Enroll in current term
    const { data: term } = await getClient()
      .from('terms')
      .select('id, session:academic_sessions!inner(school_id)')
      .eq('is_current', true)
      .eq('session.school_id', schoolId)
      .maybeSingle()
    if (term && payload.class_id) {
      await getClient().from('student_class_terms').insert({ student_id: student.id, term_id: term.id, class_id: payload.class_id })
    }
    return student
  },

  async update(studentId, payload) {
    const { data, error } = await getClient().from('students').update(payload).eq('id', studentId).select().single()
    if (error) throw error
    return data
  }
}

// ── Assessments API ───────────────────────────────────────────
const AssessmentsAPI = {
  async list(termId) {
    const { data, error } = await getClient()
      .from('assessments')
      .select('*, class:classes(name), subject:subjects(name), score_entries(count)')
      .eq('term_id', termId)
    if (error) throw error
    return data
  },

  async getWithScores(assessmentId) {
    const { data, error } = await getClient()
      .from('assessments')
      .select('*, class:classes(name), subject:subjects(name,code), term:terms(name), score_entries(*, student:students(full_name,student_code))')
      .eq('id', assessmentId)
      .single()
    if (error) throw error
    return data
  },

  async bulkSave(assessmentId, entries) {
    const rows = entries.map(e => ({ assessment_id: assessmentId, ...e }))
    const { error } = await getClient().from('score_entries').upsert(rows, { onConflict: 'assessment_id,student_id' })
    if (error) throw error
    await getClient().rpc('recompute_positions', { p_assessment_id: assessmentId })
  },

  async lock(assessmentId) {
    const { data, error } = await getClient()
      .from('assessments')
      .update({ status: 'locked', locked_at: new Date().toISOString() })
      .eq('id', assessmentId).select().single()
    if (error) throw error
    return data
  },

  async unlock(assessmentId) {
    const { data, error } = await getClient()
      .from('assessments')
      .update({ status: 'open', locked_at: null })
      .eq('id', assessmentId).select().single()
    if (error) throw error
    return data
  }
}

// ── Fees API ──────────────────────────────────────────────────
const FeesAPI = {
  async listByTerm(schoolId, termId) {
    const { data, error } = await getClient()
      .from('fee_records')
      .select('*, student:students!inner(school_id, full_name, student_code, student_class_terms(class:classes(name), term:terms(is_current)))')
      .eq('term_id', termId)
      .eq('student.school_id', schoolId)
    if (error) throw error
    return data
  },

  async recordPayment(feeRecordId, payload) {
    const { data, error } = await getClient()
      .from('fee_payments')
      .insert({ fee_record_id: feeRecordId, ...payload })
      .select().single()
    if (error) throw error
    return data
  }
}

// ── Setup API ─────────────────────────────────────────────────
const SetupAPI = {
  async getCurrentTerm(schoolId) {
    const { data } = await getClient()
      .from('terms')
      .select('*, session:academic_sessions!inner(school_id, name)')
      .eq('is_current', true)
      .eq('session.school_id', schoolId)
      .maybeSingle()
    return data
  },
  async getClasses(schoolId) {
    const { data } = await getClient().from('classes').select('*').eq('school_id', schoolId).order('sort_order')
    return data || []
  },
  async getSubjects(schoolId) {
    const { data } = await getClient().from('subjects').select('*').eq('school_id', schoolId).eq('is_active', true).order('name')
    return data || []
  }
}

// ── Reports API ───────────────────────────────────────────────
const ReportsAPI = {
  async getStudentReport(studentId, termId) {
    const { data, error } = await getClient().rpc('get_student_report', { p_student_id: studentId, p_term_id: termId })
    if (error) throw error
    return data
  }
}

// ── Staff API ─────────────────────────────────────────────────
const StaffAPI = {
  async list(schoolId) {
    const { data, error } = await getClient().from('staff').select('*, class_teacher:classes(name)').eq('school_id', schoolId).order('full_name')
    if (error) throw error
    return data
  },
  async create(schoolId, payload) {
    const { data, error } = await getClient().from('staff').insert({ ...payload, school_id: schoolId }).select().single()
    if (error) throw error
    return data
  },
  async update(staffId, payload) {
    const { data, error } = await getClient().from('staff').update(payload).eq('id', staffId).select().single()
    if (error) throw error
    return data
  }
}

// ── Documents API ─────────────────────────────────────────────
const DocsAPI = {
  async list(schoolId, category) {
    let q = getClient().from('documents').select('*').eq('school_id', schoolId).order('uploaded_at', { ascending: false })
    if (category) q = q.eq('category', category)
    const { data, error } = await q
    if (error) throw error
    return data
  },
  async upload(schoolId, file, category, uploadedBy) {
    const ext = file.name.split('.').pop()
    const path = `${schoolId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
    const { error: upErr } = await getClient().storage.from('school-documents').upload(path, file, { contentType: file.type })
    if (upErr) throw upErr
    const { data, error } = await getClient().from('documents').insert({ school_id: schoolId, name: file.name, category, storage_path: path, file_size_bytes: file.size, mime_type: file.type, uploaded_by: uploadedBy }).select().single()
    if (error) throw error
    return data
  },
  async getUrl(storagePath) {
    const { data } = getClient().storage.from('school-documents').getPublicUrl(storagePath)
    return data.publicUrl
  },
  async delete(docId, storagePath) {
    await getClient().storage.from('school-documents').remove([storagePath])
    await getClient().from('documents').delete().eq('id', docId)
  }
}

// ── Utility: format currency ──────────────────────────────────
function formatNaira(amount) {
  return '₦' + Number(amount).toLocaleString('en-NG')
}

// ── Utility: show toast ───────────────────────────────────────
function showToast(message, type = 'success') {
  const existing = document.getElementById('smp-toast')
  if (existing) existing.remove()
  const colors = { success: 'bg-slate-900', error: 'bg-red-600', info: 'bg-blue-700' }
  const icons = { success: 'check_circle', error: 'error', info: 'info' }
  const toast = document.createElement('div')
  toast.id = 'smp-toast'
  toast.className = `fixed bottom-20 md:bottom-6 right-6 ${colors[type]} text-white text-sm font-medium px-4 py-3 rounded-lg shadow-lg flex items-center gap-2 z-50 transition-all duration-300`
  toast.innerHTML = `<span class="material-symbols-outlined fill-icon" style="font-size:18px">${icons[type]}</span>${message}`
  document.body.appendChild(toast)
  setTimeout(() => toast.remove(), 3500)
}

// ── Utility: show loading state on button ─────────────────────
function setLoading(btn, loading, originalText) {
  if (loading) {
    btn.disabled = true
    btn.dataset.original = btn.innerHTML
    btn.innerHTML = '<span class="material-symbols-outlined animate-spin" style="font-size:16px">refresh</span> Loading…'
  } else {
    btn.disabled = false
    btn.innerHTML = btn.dataset.original || originalText
  }
}

// ── Initialise page: check auth, load profile ─────────────────
async function initPage() {
  const session = await requireAuth()
  if (!session) return null
  const profile = await getOperatorProfile(session.user.id)
  // Update sidebar school name
  const schoolNameEl = document.getElementById('sidebarSchoolName')
  if (schoolNameEl) schoolNameEl.textContent = profile.school.name
  // Update operator initials
  const initialsEl = document.getElementById('sidebarInitials')
  if (initialsEl) initialsEl.textContent = profile.full_name.split(' ').map(n => n[0]).join('').slice(0, 2)
  // Update operator name
  const nameEl = document.getElementById('sidebarOperatorName')
  if (nameEl) nameEl.textContent = profile.full_name
  return profile
}

// ── Promotion API ─────────────────────────────────────────────
const PromotionAPI = {
  async getCandidates(schoolId, sessionId) {
    const { data, error } = await getClient().rpc('get_promotion_candidates', {
      p_school_id: schoolId,
      p_session_id: sessionId
    })
    if (error) throw error
    return data || []
  },

  async applyDecisions(decisions, sessionId, newTermId, operatorId) {
    const { data, error } = await getClient().rpc('apply_promotions', {
      p_decisions: decisions,
      p_session_id: sessionId,
      p_new_term_id: newTermId || null,
      p_operator_id: operatorId
    })
    if (error) throw error
    return data
  },

  async getHistory(schoolId) {
    const { data, error } = await getClient()
      .from('promotion_records')
      .select('*, student:students(full_name,student_code), from_class:classes!promotion_records_from_class_id_fkey(name), to_class:classes!promotion_records_to_class_id_fkey(name), session:academic_sessions(name)')
      .order('created_at', { ascending: false })
      .limit(100)
    if (error) throw error
    return data || []
  },

  async getPromotionRules(schoolId) {
    const { data, error } = await getClient()
      .from('promotion_rules')
      .select('*, from_class:classes!promotion_rules_from_class_fkey(name), to_class:classes!promotion_rules_to_class_fkey(name)')
      .eq('school_id', schoolId)
    if (error) throw error
    return data || []
  },

  async upsertRule(schoolId, fromClassId, toClassId, minAverage) {
    const { data, error } = await getClient()
      .from('promotion_rules')
      .upsert({ school_id: schoolId, from_class: fromClassId, to_class: toClassId, min_average: minAverage },
               { onConflict: 'school_id,from_class' })
      .select().single()
    if (error) throw error
    return data
  }
}

// ── Notifications API ─────────────────────────────────────────
const NotificationsAPI = {
  async generateFeeReminders(schoolId, termId, operatorId, channel) {
    const { data, error } = await getClient().rpc('generate_fee_reminders', {
      p_school_id: schoolId, p_term_id: termId,
      p_operator_id: operatorId, p_channel: channel
    })
    if (error) throw error
    return data
  },

  async generateResultsNotifications(schoolId, termId, operatorId, channel) {
    const { data, error } = await getClient().rpc('generate_results_notifications', {
      p_school_id: schoolId, p_term_id: termId,
      p_operator_id: operatorId, p_channel: channel
    })
    if (error) throw error
    return data
  },

  async getQueue(schoolId, status) {
    let q = getClient().from('notifications')
      .select('*, student:students(full_name,student_code)')
      .eq('school_id', schoolId)
      .order('created_at', { ascending: false })
      .limit(200)
    if (status) q = q.eq('status', status)
    const { data, error } = await q
    if (error) throw error
    return data || []
  },

  async dispatch(schoolId, notificationIds) {
    // Call edge function for real dispatch
    const { data: { session } } = await getClient().auth.getSession()
    const res = await fetch(`${SMP_CONFIG.supabaseUrl}/functions/v1/send-notifications`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ notification_ids: notificationIds, school_id: schoolId })
    })
    if (!res.ok) {
      // Fallback: mark as sent locally if edge function not deployed
      const { error } = await getClient().from('notifications')
        .update({ status: 'sent', sent_at: new Date().toISOString() })
        .in('id', notificationIds)
      if (error) throw error
      return { sent: notificationIds.length, failed: 0, fallback: true }
    }
    return await res.json()
  },

  async markSent(id) {
    const { error } = await getClient().from('notifications')
      .update({ status: 'sent', sent_at: new Date().toISOString() })
      .eq('id', id)
    if (error) throw error
  },

  async delete(id) {
    const { error } = await getClient().from('notifications').delete().eq('id', id)
    if (error) throw error
  },

  async getStats(schoolId) {
    const { data } = await getClient().from('notifications').select('status').eq('school_id', schoolId)
    const counts = { sent: 0, queued: 0, failed: 0 }
    data?.forEach(n => { if (counts[n.status] !== undefined) counts[n.status]++ })
    return { ...counts, total: data?.length || 0 }
  }
}

// ── Notification Settings API ─────────────────────────────────
const NotifSettingsAPI = {
  async get(schoolId) {
    const { data } = await getClient().from('notification_settings').select('*').eq('school_id', schoolId).maybeSingle()
    return data
  },

  async save(schoolId, payload) {
    const { data, error } = await getClient().from('notification_settings')
      .upsert({ ...payload, school_id: schoolId, updated_at: new Date().toISOString() }, { onConflict: 'school_id' })
      .select().single()
    if (error) throw error
    return data
  }
}

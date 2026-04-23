const adminClient = require('../supabase/adminClient');

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Helper: get Monday and Sunday of a given date's week
function getWeekBounds(dateStr) {
    const d = dateStr ? new Date(dateStr) : new Date();
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Monday
    const monday = new Date(d.setDate(diff));
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    return {
        week_start: monday.toISOString().split('T')[0],
        week_end: sunday.toISOString().split('T')[0]
    };
}

// Verify user is a participant of the contract
async function assertContractParticipant(contractId, userId) {
    const { data, error } = await adminClient
        .from('contracts')
        .select('client_id, freelancer_id, project_type, status, agreed_rate')
        .eq('id', contractId)
        .maybeSingle();
    if (error || !data) return null;
    if (data.client_id !== userId && data.freelancer_id !== userId) return null;
    return data;
}

// ─── TIMESHEETS ────────────────────────────────────────────────────────────────

// GET /api/hourly/timesheets?contract_id=&week_start=
exports.getTimesheets = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const { contract_id, week_start, status } = req.query;

        let query = adminClient
            .from('timesheets')
            .select(`
                *,
                contract:contracts(title, agreed_rate, project_type),
                freelancer:users!timesheets_freelancer_id_fkey(id, profiles(name, avatar_url)),
                entries:work_diary_entries(id, work_date, hours, description)
            `)
            .or(`freelancer_id.eq.${userId},client_id.eq.${userId}`)
            .order('week_start', { ascending: false });

        if (contract_id) query = query.eq('contract_id', contract_id);
        if (week_start) query = query.eq('week_start', week_start);
        if (status) query = query.eq('status', status);

        const { data, error } = await query;
        if (error) throw error;

        res.status(200).json({ success: true, data: data || [] });
    } catch (err) {
        next(err);
    }
};

// POST /api/hourly/timesheets — freelancer creates/gets timesheet for a week
exports.getOrCreateTimesheet = async (req, res, next) => {
    try {
        const freelancerId = req.user.id;
        const { contract_id, date } = req.body;

        if (!contract_id || !UUID_REGEX.test(contract_id)) {
            return res.status(400).json({ success: false, message: 'Valid contract_id required' });
        }

        const contract = await assertContractParticipant(contract_id, freelancerId);
        if (!contract) return res.status(404).json({ success: false, message: 'Contract not found' });
        if (contract.freelancer_id !== freelancerId) {
            return res.status(403).json({ success: false, message: 'Only freelancers can create timesheets' });
        }
        if (contract.project_type !== 'HOURLY') {
            return res.status(400).json({ success: false, message: 'Timesheets are only for HOURLY contracts' });
        }

        const { week_start, week_end } = getWeekBounds(date);

        const { data: existing } = await adminClient
            .from('timesheets')
            .select('*')
            .eq('contract_id', contract_id)
            .eq('week_start', week_start)
            .maybeSingle();

        if (existing) return res.status(200).json({ success: true, data: existing });

        const { data, error } = await adminClient
            .from('timesheets')
            .insert([{
                contract_id,
                freelancer_id: freelancerId,
                client_id: contract.client_id,
                week_start,
                week_end,
                total_hours: 0,
                total_amount: 0,
                status: 'PENDING'
            }])
            .select()
            .single();

        if (error) throw error;
        res.status(201).json({ success: true, data });
    } catch (err) {
        next(err);
    }
};

// PATCH /api/hourly/timesheets/:id/status — client approves/disputes
exports.updateTimesheetStatus = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const { id } = req.params;
        const { status, memo } = req.body;

        const allowed = ['APPROVED', 'DISPUTED'];
        if (!allowed.includes(status)) {
            return res.status(400).json({ success: false, message: `Status must be one of: ${allowed.join(', ')}` });
        }

        const { data: ts } = await adminClient
            .from('timesheets')
            .select('client_id, freelancer_id, status')
            .eq('id', id)
            .maybeSingle();

        if (!ts) return res.status(404).json({ success: false, message: 'Timesheet not found' });
        if (ts.client_id !== userId) return res.status(403).json({ success: false, message: 'Only the client can approve/dispute' });
        if (ts.status === 'PAID') return res.status(400).json({ success: false, message: 'Cannot update a paid timesheet' });

        const { data, error } = await adminClient
            .from('timesheets')
            .update({ status, memo: memo || null })
            .eq('id', id)
            .select()
            .single();

        if (error) throw error;

        await adminClient.from('notifications').insert([{
            user_id: ts.freelancer_id,
            title: `Timesheet ${status === 'APPROVED' ? 'Approved' : 'Disputed'}`,
            content: `Your timesheet has been ${status.toLowerCase()}${memo ? ': ' + memo : ''}.`,
            type: 'CONTRACT_UPDATE'
        }]);

        res.status(200).json({ success: true, data });
    } catch (err) {
        next(err);
    }
};

// ─── WORK DIARY ────────────────────────────────────────────────────────────────

// GET /api/hourly/work-diary?contract_id=&week_start=
exports.getWorkDiary = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const { contract_id, week_start } = req.query;

        if (!contract_id) return res.status(400).json({ success: false, message: 'contract_id required' });

        const contract = await assertContractParticipant(contract_id, userId);
        if (!contract) return res.status(404).json({ success: false, message: 'Contract not found' });

        let query = adminClient
            .from('work_diary_entries')
            .select('*')
            .eq('contract_id', contract_id)
            .order('work_date', { ascending: false });

        if (week_start) {
            const { week_end } = getWeekBounds(week_start);
            query = query.gte('work_date', week_start).lte('work_date', week_end);
        }

        const { data, error } = await query;
        if (error) throw error;

        res.status(200).json({ success: true, data: data || [] });
    } catch (err) {
        next(err);
    }
};

// POST /api/hourly/work-diary — freelancer logs time
exports.addWorkDiaryEntry = async (req, res, next) => {
    try {
        const freelancerId = req.user.id;
        const { contract_id, work_date, hours, description, screenshot_url } = req.body;

        if (!contract_id || !UUID_REGEX.test(contract_id)) {
            return res.status(400).json({ success: false, message: 'Valid contract_id required' });
        }
        if (!work_date) return res.status(400).json({ success: false, message: 'work_date required' });
        if (!hours || isNaN(hours) || hours <= 0 || hours > 24) {
            return res.status(400).json({ success: false, message: 'hours must be between 0 and 24' });
        }
        if (!description?.trim()) {
            return res.status(400).json({ success: false, message: 'description required' });
        }

        const contract = await assertContractParticipant(contract_id, freelancerId);
        if (!contract) return res.status(404).json({ success: false, message: 'Contract not found' });
        if (contract.freelancer_id !== freelancerId) {
            return res.status(403).json({ success: false, message: 'Only the freelancer can log time' });
        }
        if (contract.project_type !== 'HOURLY') {
            return res.status(400).json({ success: false, message: 'Time logging is only for HOURLY contracts' });
        }

        // Get or create timesheet for this week
        const { week_start, week_end } = getWeekBounds(work_date);
        let { data: ts } = await adminClient
            .from('timesheets')
            .select('id, total_hours, total_amount')
            .eq('contract_id', contract_id)
            .eq('week_start', week_start)
            .maybeSingle();

        if (!ts) {
            const { data: newTs, error: tsErr } = await adminClient
                .from('timesheets')
                .insert([{
                    contract_id,
                    freelancer_id: freelancerId,
                    client_id: contract.client_id,
                    week_start,
                    week_end,
                    total_hours: 0,
                    total_amount: 0,
                    status: 'PENDING'
                }])
                .select()
                .single();
            if (tsErr) throw tsErr;
            ts = newTs;
        }

        const { data: entry, error: entryErr } = await adminClient
            .from('work_diary_entries')
            .insert([{
                timesheet_id: ts.id,
                contract_id,
                freelancer_id: freelancerId,
                work_date,
                hours: Number(hours),
                description: description.trim(),
                screenshot_url: screenshot_url || null
            }])
            .select()
            .single();

        if (entryErr) throw entryErr;

        // Update timesheet totals
        const newHours = Number(ts.total_hours) + Number(hours);
        const newAmount = newHours * Number(contract.agreed_rate);
        await adminClient
            .from('timesheets')
            .update({ total_hours: newHours, total_amount: newAmount })
            .eq('id', ts.id);

        res.status(201).json({ success: true, data: entry });
    } catch (err) {
        next(err);
    }
};

// DELETE /api/hourly/work-diary/:id
exports.deleteWorkDiaryEntry = async (req, res, next) => {
    try {
        const freelancerId = req.user.id;
        const { id } = req.params;

        const { data: entry } = await adminClient
            .from('work_diary_entries')
            .select('*, timesheets(total_hours, total_amount), contracts(agreed_rate)')
            .eq('id', id)
            .maybeSingle();

        if (!entry) return res.status(404).json({ success: false, message: 'Entry not found' });
        if (entry.freelancer_id !== freelancerId) return res.status(403).json({ success: false, message: 'Not authorized' });

        const { error } = await adminClient.from('work_diary_entries').delete().eq('id', id);
        if (error) throw error;

        // Update timesheet totals
        const newHours = Math.max(0, Number(entry.timesheets?.total_hours) - Number(entry.hours));
        const newAmount = newHours * Number(entry.contracts?.agreed_rate || 0);
        await adminClient
            .from('timesheets')
            .update({ total_hours: newHours, total_amount: newAmount })
            .eq('id', entry.timesheet_id);

        res.status(200).json({ success: true, message: 'Entry deleted' });
    } catch (err) {
        next(err);
    }
};

// ─── TIME BY FREELANCER ────────────────────────────────────────────────────────

// GET /api/hourly/time-by-freelancer — client sees summary per freelancer
exports.getTimeByFreelancer = async (req, res, next) => {
    try {
        const clientId = req.user.id;
        const { from, to } = req.query;

        let query = adminClient
            .from('timesheets')
            .select(`
                freelancer_id,
                total_hours,
                total_amount,
                week_start,
                status,
                freelancer:users!timesheets_freelancer_id_fkey(id, profiles(name, avatar_url)),
                contract:contracts(id, title, agreed_rate)
            `)
            .eq('client_id', clientId);

        if (from) query = query.gte('week_start', from);
        if (to) query = query.lte('week_start', to);

        const { data, error } = await query;
        if (error) throw error;

        // Group by freelancer
        const grouped = {};
        for (const row of data || []) {
            const fid = row.freelancer_id;
            if (!grouped[fid]) {
                grouped[fid] = {
                    freelancer_id: fid,
                    freelancer: row.freelancer,
                    total_hours: 0,
                    total_amount: 0,
                    contracts: {}
                };
            }
            grouped[fid].total_hours += Number(row.total_hours);
            grouped[fid].total_amount += Number(row.total_amount);
            const cid = row.contract?.id;
            if (cid) {
                if (!grouped[fid].contracts[cid]) {
                    grouped[fid].contracts[cid] = { ...row.contract, hours: 0, amount: 0 };
                }
                grouped[fid].contracts[cid].hours += Number(row.total_hours);
                grouped[fid].contracts[cid].amount += Number(row.total_amount);
            }
        }

        const result = Object.values(grouped).map(f => ({
            ...f,
            contracts: Object.values(f.contracts)
        }));

        res.status(200).json({ success: true, data: result });
    } catch (err) {
        next(err);
    }
};

// ─── CUSTOM EXPORT ─────────────────────────────────────────────────────────────

// GET /api/hourly/export?contract_id=&from=&to=&format=csv|json
exports.exportActivity = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const { contract_id, from, to, format = 'json' } = req.query;

        let query = adminClient
            .from('work_diary_entries')
            .select(`
                work_date, hours, description, screenshot_url,
                contract:contracts(title, agreed_rate),
                freelancer:users!work_diary_entries_freelancer_id_fkey(id, profiles(name))
            `)
            .or(`freelancer_id.eq.${userId}`)
            .order('work_date', { ascending: true });

        if (contract_id) query = query.eq('contract_id', contract_id);
        if (from) query = query.gte('work_date', from);
        if (to) query = query.lte('work_date', to);

        const { data, error } = await query;
        if (error) throw error;

        if (format === 'csv') {
            const rows = (data || []).map(e => ({
                date: e.work_date,
                freelancer: e.freelancer?.profiles?.name || '',
                contract: e.contract?.title || '',
                hours: e.hours,
                rate: e.contract?.agreed_rate || 0,
                amount: (Number(e.hours) * Number(e.contract?.agreed_rate || 0)).toFixed(2),
                description: `"${(e.description || '').replace(/"/g, '""')}"`
            }));

            const header = 'Date,Freelancer,Contract,Hours,Rate,Amount,Description';
            const csv = [header, ...rows.map(r =>
                `${r.date},${r.freelancer},${r.contract},${r.hours},${r.rate},${r.amount},${r.description}`
            )].join('\n');

            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', 'attachment; filename="hourly_activity.csv"');
            return res.send(csv);
        }

        res.status(200).json({ success: true, data: data || [] });
    } catch (err) {
        next(err);
    }
};

const adminClient = require('../supabase/adminClient');
const { randomBytes } = require('crypto');
const { generateRtcToken } = require('../utils/agoraToken');

const generateChannelName = (projectId) => {
    const rand = randomBytes(8).toString('hex');
    return projectId ? `project-${projectId}-${rand}` : `meet-${rand}`;
};

// Helper — fetch participant profiles from meeting_participants table
const getParticipantProfiles = async (meetingId) => {
    const { data } = await adminClient
        .from('meeting_participants')
        .select('user_id, agora_uid, joined_at')
        .eq('meeting_id', meetingId);

    if (!data || data.length === 0) return [];

    // Deduplicate by user_id
    const seen = new Set();
    const unique = data.filter(p => {
        if (seen.has(p.user_id)) return false;
        seen.add(p.user_id);
        return true;
    });

    const userIds = unique.map(p => p.user_id);
    const { data: profiles } = await adminClient
        .from('profiles')
        .select('user_id, name, avatar_url')
        .in('user_id', userIds);

    const profileMap = Object.fromEntries((profiles || []).map(p => [p.user_id, p]));

    return unique.map(p => ({
        user_id: p.user_id,
        agora_uid: p.agora_uid,
        joined_at: p.joined_at,
        name: profileMap[p.user_id]?.name || null,
        avatar_url: profileMap[p.user_id]?.avatar_url || null
    })).filter(p => p.name !== null); // exclude unknown/bot participants
};

// Helper — add user to meeting_participants (upsert)
const addParticipant = async (meetingId, userId, agoraUid = null) => {
    await adminClient
        .from('meeting_participants')
        .upsert([{ meeting_id: meetingId, user_id: userId, agora_uid: agoraUid }],
            { onConflict: 'meeting_id,user_id', ignoreDuplicates: false });
};

// ─── CREATE MEETING ───────────────────────────────────────────────────────────
exports.createMeeting = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const { projectId, clientId, freelancerId, conversation_id, title, scheduled_at } = req.body;

        // ─── ENTERPRISE ENFORCEMENT: Meeting Gate ────────────────────────
        if (!projectId) {
            return res.status(400).json({ success: false, message: 'projectId is mandatory for meeting creation.' });
        }

        // Verify project context has a FUNDED milestone
        const { data: fundedMilestone, error: fundingErr } = await adminClient
            .from('milestones')
            .select('id, status')
            .eq('contract_id', projectId) // projectId is likely the contractId in this context
            .eq('status', 'FUNDED')
            .maybeSingle();

        if (fundingErr || !fundedMilestone) {
            return res.status(403).json({ 
                success: false, 
                message: 'Meetings are disabled until the first milestone is funded. Please secure the project escrow to unlock video calls.' 
            });
        }
        // ────────────────────────────────────────────────────────────────

        const invitees = [...new Set([clientId, freelancerId].filter(Boolean))];
        const channelName = generateChannelName(projectId);

        const { data, error } = await adminClient
            .from('meetings')
            .insert([{
                host_id: userId,
                conversation_id: conversation_id || null,
                project_id: projectId, // Guaranteed present
                title: title || 'Project Strategy Meeting',
                room_id: channelName,
                room_code: channelName,
                participants: [userId, ...invitees],
                status: 'scheduled',
                scheduled_at: scheduled_at || null
            }])
            .select('id, room_id, title, status, host_id, conversation_id, created_at, scheduled_at')
            .single();

        if (error) throw error;

        // Add host to meeting_participants immediately
        await addParticipant(data.id, userId);

        // Notify invitees
        if (invitees.length > 0) {
            await adminClient.from('notifications').insert(
                invitees.map(recipientId => ({
                    user_id: recipientId,
                    title: 'Meeting Invitation',
                    content: `You have been invited to: "${data.title}"`,
                    type: 'MEETING',
                    link: `/meeting/${data.id}`,
                    metadata: { meetingId: data.id }
                }))
            );
            try {
                const { getIO } = require('../socket/index');
                const io = getIO();
                const { data: hostProfile } = await adminClient
                    .from('profiles').select('name, avatar_url').eq('user_id', userId).maybeSingle();
                invitees.forEach(recipientId => {
                    io.to(`user:${recipientId}`).emit('meeting-invite', {
                        meetingId: data.id,
                        title: data.title,
                        hostName: hostProfile?.name || 'Someone',
                        hostAvatar: hostProfile?.avatar_url || null
                    });
                });
            } catch (e) { /* socket optional */ }
        }

        // ISSUE 1 — join_url is always a relative path
        res.status(201).json({
            success: true,
            data: {
                id: data.id,
                room_id: data.room_id,
                title: data.title,
                status: data.status,
                host_id: data.host_id,
                join_url: `/meeting/${data.id}`
            }
        });
    } catch (err) {
        next(err);
    }
};

// ─── GET MEETING BY ID ────────────────────────────────────────────────────────
exports.getMeetingById = async (req, res, next) => {
    try {
        const { id } = req.params;
        const userId = req.user.id;

        const { data, error } = await adminClient
            .from('meetings')
            .select(`
                id, host_id, conversation_id, project_id, title, 
                room_id, room_code, participants, status, 
                scheduled_at, started_at, ended_at, recording, created_at
            `)
            .eq('id', id)
            .maybeSingle();
        

        if (error) throw error;
        if (!data) return res.status(404).json({ success: false, message: 'Meeting not found' });

        const participants = data.participants || [];
        if (!participants.includes(userId) && data.host_id !== userId) {
            return res.status(403).json({ success: false, message: 'Access denied — you are not a participant' });
        }

        // ISSUE 2 — participant_profiles from meeting_participants table
        const participant_profiles = await getParticipantProfiles(id);

        res.status(200).json({
            success: true,
            data: {
                ...data,
                join_url: `/meeting/${data.id}`,
                participant_profiles
            }
        });
    } catch (err) {
        next(err);
    }
};

// ─── GET TOKEN ────────────────────────────────────────────────────────────────
exports.getMeetingToken = async (req, res, next) => {
    try {
        const { id } = req.params;
        const userId = req.user.id;

        const { data: meeting } = await adminClient
            .from('meetings')
            .select('id, room_id, status, participants, host_id')
            .eq('id', id)
            .maybeSingle();

        if (!meeting) return res.status(404).json({ success: false, message: 'Meeting not found' });
        if (meeting.status === 'ended') return res.status(410).json({ success: false, message: 'Meeting has ended' });

        const participants = meeting.participants || [];
        if (!participants.includes(userId) && meeting.host_id !== userId) {
            return res.status(403).json({ success: false, message: 'Access denied' });
        }

        // Fix null room_id
        if (!meeting.room_id) {
            const newRoomId = `meet-${randomBytes(8).toString('hex')}`;
            await adminClient.from('meetings').update({ room_id: newRoomId, room_code: newRoomId }).eq('id', id);
            meeting.room_id = newRoomId;
        }

        if (!process.env.AGORA_APP_ID || !process.env.AGORA_APP_CERTIFICATE) {
            return res.status(200).json({
                success: true,
                data: { token: null, appId: null, channelName: meeting.room_id, uid: 0 }
            });
        }

        // ISSUE 6 — generate random uid, save to meeting_participants
        const uid = Math.floor(Math.random() * 100000) + 1;
        const { token } = generateRtcToken(meeting.room_id, uid, 'publisher');

        // Save agora_uid to participant record
        await adminClient.from('meeting_participants')
            .upsert([{ meeting_id: id, user_id: userId, agora_uid: uid }],
                { onConflict: 'meeting_id,user_id' });

        res.status(200).json({
            success: true,
            data: {
                token,
                uid,
                appId: process.env.AGORA_APP_ID,
                channelName: meeting.room_id
            }
        });
    } catch (err) {
        next(err);
    }
};

// ─── START MEETING ────────────────────────────────────────────────────────────
exports.startMeeting = async (req, res, next) => {
    try {
        const { id } = req.params;
        const userId = req.user.id;

        const { data: meeting } = await adminClient
            .from('meetings').select('host_id, participants, status').eq('id', id).maybeSingle();

        if (!meeting) return res.status(404).json({ success: false, message: 'Meeting not found' });

        const participants = meeting.participants || [];
        if (!participants.includes(userId) && meeting.host_id !== userId) {
            return res.status(403).json({ success: false, message: 'Access denied' });
        }

        await adminClient.from('meetings')
            .update({ status: 'live', started_at: new Date().toISOString() })
            .eq('id', id);

        // ISSUE 3 — add caller to meeting_participants
        await addParticipant(id, userId);

        res.status(200).json({ success: true });
    } catch (err) {
        next(err);
    }
};

// ─── END MEETING ──────────────────────────────────────────────────────────────
exports.endMeeting = async (req, res, next) => {
    try {
        const { id } = req.params;
        const userId = req.user.id;

        const { data: meeting } = await adminClient
            .from('meetings').select('host_id').eq('id', id).maybeSingle();

        if (!meeting) return res.status(404).json({ success: false, message: 'Meeting not found' });
        if (meeting.host_id !== userId) {
            return res.status(403).json({ success: false, message: 'Only the host can end the meeting' });
        }

        await adminClient.from('meetings')
            .update({ status: 'ended', ended_at: new Date().toISOString() })
            .eq('id', id);

        res.status(200).json({ success: true });
    } catch (err) {
        next(err);
    }
};

// ─── INVITE PARTICIPANT ───────────────────────────────────────────────────────
exports.inviteParticipant = async (req, res, next) => {
    try {
        const { id } = req.params;
        const hostId = req.user.id;
        const { userId: inviteeId } = req.body;

        if (!inviteeId) return res.status(400).json({ success: false, message: 'userId is required' });

        const { data: meeting } = await adminClient
            .from('meetings')
            .select('id, title, participants, host_id')
            .eq('id', id)
            .maybeSingle();

        if (!meeting) return res.status(404).json({ success: false, message: 'Meeting not found' });
        if (meeting.host_id !== hostId) return res.status(403).json({ success: false, message: 'Only host can invite' });

        // Add to participants array
        const participants = [...new Set([...(meeting.participants || []), inviteeId])];
        await adminClient.from('meetings').update({ participants }).eq('id', id);

        // ISSUE 5 — notification metadata must contain meetingId
        await adminClient.from('notifications').insert([{
            user_id: inviteeId,
            title: 'Meeting Invitation',
            content: `You have been invited to join: "${meeting.title}"`,
            type: 'MEETING',
            link: `/meeting/${id}`,
            metadata: { meetingId: id }
        }]);

        // ISSUE 4 — emit correct socket shape with hostName + hostAvatar
        try {
            const { getIO } = require('../socket/index');
            const io = getIO();
            const { data: hostProfile } = await adminClient
                .from('profiles').select('name, avatar_url').eq('user_id', hostId).maybeSingle();

            io.to(`user:${inviteeId}`).emit('meeting-invite', {
                meetingId: id,
                title: meeting.title,
                hostName: hostProfile?.name || 'Someone',
                hostAvatar: hostProfile?.avatar_url || null
            });
        } catch (e) { /* socket optional */ }

        res.status(200).json({ success: true });
    } catch (err) {
        next(err);
    }
};

// ─── MY MEETINGS ──────────────────────────────────────────────────────────────
exports.getMyMeetings = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const { data, error } = await adminClient
            .from('meetings')
            .select('id, title, status, scheduled_at, created_at, host_id, room_id')
            .contains('participants', [userId])
            .order('created_at', { ascending: false })
            .limit(20);

        if (error) throw error;
        res.status(200).json({ success: true, data: data || [] });
    } catch (err) {
        next(err);
    }
};

// ─── JOIN BY ROOM CODE ────────────────────────────────────────────────────────
exports.getMeetingByCode = async (req, res, next) => {
    try {
        const { roomCode } = req.params;
        const userId = req.user.id;

        const { data, error } = await adminClient
            .from('meetings')
            .select('id, host_id, title, status, room_id, room_code, participants')
            .or(`room_code.eq.${roomCode},room_id.eq.${roomCode}`)
            .maybeSingle();

        if (error) throw error;
        if (!data) return res.status(404).json({ success: false, message: 'Meeting not found' });

        const participants = data.participants || [];
        if (!participants.includes(userId) && data.host_id !== userId) {
            return res.status(403).json({ success: false, message: 'Access denied' });
        }
        if (data.status === 'ended') return res.status(410).json({ success: false, message: 'Meeting has ended' });

        res.status(200).json({ success: true, data: { ...data, join_url: `/meeting/${data.id}` } });
    } catch (err) {
        next(err);
    }
};

// ─── CLOUD RECORDING ──────────────────────────────────────────────────────────
exports.startRecording = async (req, res, next) => {
    try {
        const { id } = req.params;
        const userId = req.user.id;

        const { data: meeting } = await adminClient
            .from('meetings')
            .select('id, room_id, status, participants, host_id, recording')
            .eq('id', id)
            .maybeSingle();

        if (!meeting) return res.status(404).json({ success: false, message: 'Meeting not found' });

        const participants = meeting.participants || [];
        if (!participants.includes(userId) && meeting.host_id !== userId) {
            return res.status(403).json({ success: false, message: 'Access denied' });
        }
        if (meeting.status !== 'live') {
            return res.status(400).json({ success: false, message: 'Meeting must be live to record' });
        }
        if (meeting.recording?.sid) {
            return res.status(400).json({ success: false, message: 'Recording already in progress' });
        }
        if (!process.env.AGORA_CUSTOMER_ID || !process.env.AGORA_CUSTOMER_SECRET) {
            return res.status(400).json({ success: false, message: 'Agora recording credentials not configured' });
        }

        const { acquireResource, startRecording } = require('../utils/agoraRecording');
        // uid 999 is reserved for the recording bot — NOT added to meeting_participants
        const { token } = generateRtcToken(meeting.room_id, 999, 'publisher');
        const resourceId = await acquireResource(meeting.room_id, '999');
        const sid = await startRecording(resourceId, meeting.room_id, token, '999');

        await adminClient.from('meetings').update({
            recording: { resourceId, sid, fileList: [], playbackUrl: null, startedAt: new Date().toISOString() }
        }).eq('id', id);

        res.status(200).json({ success: true });
    } catch (err) {
        next(err);
    }
};

exports.stopRecording = async (req, res, next) => {
    try {
        const { id } = req.params;
        const userId = req.user.id;

        const { data: meeting } = await adminClient
            .from('meetings')
            .select('id, room_id, participants, host_id, recording')
            .eq('id', id)
            .maybeSingle();

        if (!meeting) return res.status(404).json({ success: false, message: 'Meeting not found' });

        const participants = meeting.participants || [];
        if (!participants.includes(userId) && meeting.host_id !== userId) {
            return res.status(403).json({ success: false, message: 'Access denied' });
        }

        const { resourceId, sid } = meeting.recording || {};
        if (!resourceId || !sid) {
            return res.status(400).json({ success: false, message: 'No active recording found' });
        }

        const { stopRecording } = require('../utils/agoraRecording');
        const result = await stopRecording(resourceId, sid, meeting.room_id, '999');

        await adminClient.from('meetings').update({
            recording: {
                ...meeting.recording,
                fileList: result.fileList,
                playbackUrl: result.playbackUrl,
                stoppedAt: new Date().toISOString()
            }
        }).eq('id', id);

        res.status(200).json({ success: true, data: { playbackUrl: result.playbackUrl } });
    } catch (err) {
        next(err);
    }
};

exports.getRecordingStatus = async (req, res, next) => {
    try {
        const { id } = req.params;
        const userId = req.user.id;

        const { data: meeting } = await adminClient
            .from('meetings').select('id, recording, participants, host_id').eq('id', id).maybeSingle();

        if (!meeting) return res.status(404).json({ success: false, message: 'Meeting not found' });

        const participants = meeting.participants || [];
        if (!participants.includes(userId) && meeting.host_id !== userId) {
            return res.status(403).json({ success: false, message: 'Access denied' });
        }

        const { resourceId, sid } = meeting.recording || {};
        if (!resourceId || !sid) {
            return res.status(200).json({ success: true, data: { recording: false } });
        }

        const { queryRecording } = require('../utils/agoraRecording');
        const status = await queryRecording(resourceId, sid);
        res.status(200).json({ success: true, data: { recording: true, ...status } });
    } catch (err) {
        next(err);
    }
};

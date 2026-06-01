const supabase = require('../supabase/client');
const adminClient = require('../supabase/adminClient');
const mailer = require('../utils/mailer');
const logger = require('../utils/logger');

// ─── PERMISSIONS MAP ──────────────────────────────────────────────────────────
const PERMISSIONS_MAP = {
    MANAGER: [
        'Chat and access any company room',
        'View company address book',
        'Invite, shortlist, and interview freelancers',
        'Post jobs and review proposals',
        'Send/review offers, create contracts, and reports',
    ],
    RECRUITER: [
        'Chat and access any company room',
        'View company address book',
        'Invite, shortlist, and interview freelancers',
    ],
    MESSENGER: [
        'Chat and access any company room',
        'Review public profiles',
    ],
    MEMBER: [
        'Chat and access any company room',
        'View active project and milestone progress',
        'Collaborate in project-specific chat channels',
    ],
};

// ─── CREATE TEAM ──────────────────────────────────────────────────────────────
exports.createTeam = async (req, res, next) => {
    try {
        const { name } = req.body;
        const clientId = req.user.id;

        const { data, error } = await supabase
            .from('teams')
            .insert([{ client_id: clientId, name }])
            .select()
            .single();

        if (error) throw error;

        // Add creator as ADMIN member
        await supabase.from('team_members').insert([{
            team_id: data.id,
            user_id: clientId,
            role: 'ADMIN',
        }]);

        res.status(201).json({ success: true, data, message: 'Team created successfully' });
    } catch (error) {
        next(error);
    }
};

// ─── GET MY TEAMS ─────────────────────────────────────────────────────────────
exports.getMyTeams = async (req, res, next) => {
    try {
        const clientId = req.user.id;
        const { data, error } = await supabase
            .from('teams')
            .select('*')
            .eq('client_id', clientId);

        if (error) throw error;
        res.status(200).json({ success: true, data, message: 'Teams retrieved' });
    } catch (error) {
        next(error);
    }
};

// ─── INVITE MEMBER ────────────────────────────────────────────────────────────
exports.inviteMember = async (req, res, next) => {
    try {
        let { team_id, email, role } = req.body;
        const clientId = req.user.id;

        if (!email || !email.includes('@')) {
            return res.status(400).json({ success: false, message: 'A valid email address is required.' });
        }

        const assignedRole = (role || 'MEMBER').toUpperCase();

        // ── 1. Verify the invited email belongs to a registered user ──────────
        // Use adminClient (service role) to query auth.users — this is the only
        // reliable way to check if an email is registered without exposing data.
        const { data: authUsers, error: authErr } = await adminClient.auth.admin.listUsers({
            page: 1,
            perPage: 1000,
        });

        if (authErr) {
            logger.error('[Teams] Failed to query auth users:', authErr);
            return res.status(500).json({ success: false, message: 'Could not verify user registration. Please try again.' });
        }

        const registeredUser = authUsers?.users?.find(
            (u) => u.email?.toLowerCase() === email.toLowerCase()
        );

        if (!registeredUser) {
            return res.status(404).json({
                success: false,
                message: `No account found for ${email}. Only registered users can be invited to a team.`,
            });
        }

        const invitedUserId = registeredUser.id;

        // ── 2. Find or auto-create the client's default team ─────────────────
        if (!team_id) {
            const { data: teams, error: tError } = await supabase
                .from('teams')
                .select('id, name')
                .eq('client_id', clientId)
                .limit(1);

            if (tError) throw tError;

            if (!teams || teams.length === 0) {
                const { data: newTeam, error: cError } = await supabase
                    .from('teams')
                    .insert([{ client_id: clientId, name: 'My Company' }])
                    .select()
                    .single();
                if (cError) throw cError;
                team_id = newTeam.id;

                // Add creator as ADMIN
                await supabase.from('team_members').insert([{
                    team_id,
                    user_id: clientId,
                    role: 'ADMIN',
                }]);
            } else {
                team_id = teams[0].id;
            }
        }

        // ── 3. Verify the inviter is ADMIN of this team ───────────────────────
        const { data: callerMembership, error: memError } = await supabase
            .from('team_members')
            .select('role')
            .eq('team_id', team_id)
            .eq('user_id', clientId)
            .single();

        if (memError || callerMembership?.role !== 'ADMIN') {
            return res.status(403).json({ success: false, message: 'You are not authorized to invite members to this team.' });
        }

        // ── 4. Check if user is already a member ──────────────────────────────
        const { data: existingMember } = await supabase
            .from('team_members')
            .select('role')
            .eq('team_id', team_id)
            .eq('user_id', invitedUserId)
            .maybeSingle();

        if (existingMember) {
            return res.status(409).json({
                success: false,
                message: `${email} is already a member of this team.`,
            });
        }

        // ── 4b. Prevent self-invite ───────────────────────────────────────────
        if (invitedUserId === clientId) {
            return res.status(409).json({
                success: false,
                message: `You cannot invite yourself to your own team.`,
            });
        }

        // ── 5. Fetch inviter name, team name, and recipient name ──────────────
        const [inviterRes, teamRes, recipientRes] = await Promise.all([
            supabase.from('profiles').select('name').eq('user_id', clientId).single(),
            supabase.from('teams').select('name').eq('id', team_id).single(),
            supabase.from('profiles').select('name').eq('user_id', invitedUserId).maybeSingle(),
        ]);

        const inviterName = inviterRes.data?.name || req.user.email;
        const teamName = teamRes.data?.name || 'our team';
        const recipientName = recipientRes.data?.name || null;
        const permissions = PERMISSIONS_MAP[assignedRole] || PERMISSIONS_MAP.MEMBER;

        // ── 6. Add user to team_members ───────────────────────────────────────
        const { error: insertError } = await supabase
            .from('team_members')
            .insert([{ team_id, user_id: invitedUserId, role: assignedRole }]);

        if (insertError) {
            logger.error('[Teams] Failed to insert team member:', insertError);
            throw insertError;
        }

        // ── 7. Create in-app notification for the invited user ────────────────
        await supabase.from('notifications').insert([{
            user_id: invitedUserId,
            title: 'Team Invitation',
            content: `You have been added to ${teamName} by ${inviterName} as ${assignedRole}.`,
            type: 'SYSTEM',
        }]).catch((err) => logger.warn('[Teams] Notification insert failed:', err.message));

        // ── 8. Send invitation email ──────────────────────────────────────────
        try {
            await mailer.sendInviteEmail({
                to: email,
                inviterName,
                teamName,
                role: assignedRole,
                permissions,
                recipientName,
            });
        } catch (mailErr) {
            // Email failure should not roll back the team membership — log and continue
            logger.error('[Teams] Email send failed (user was still added to team):', mailErr.message);
            return res.status(200).json({
                success: true,
                message: `${email} has been added to the team, but the invitation email could not be sent. Please check your email configuration.`,
                emailSent: false,
            });
        }

        logger.info(`[Teams] ${email} invited to team ${team_id} as ${assignedRole} by ${clientId}`);

        res.status(200).json({
            success: true,
            message: `Invitation sent to ${email} successfully. They have been added to ${teamName} as ${assignedRole}.`,
            emailSent: true,
        });

    } catch (error) {
        next(error);
    }
};

// ─── GET MEMBERS ──────────────────────────────────────────────────────────────
exports.getMembers = async (req, res, next) => {
    try {
        const { team_id } = req.params;
        const userId = req.user.id;

        // Verify the user is in this team
        const { data: userInTeam, error: uError } = await supabase
            .from('team_members')
            .select('role')
            .eq('team_id', team_id)
            .eq('user_id', userId)
            .single();

        if (uError || !userInTeam) {
            return res.status(403).json({ success: false, data: null, message: 'Access denied' });
        }

        const { data, error } = await supabase
            .from('team_members')
            .select(`
                role,
                users (id, email),
                profiles (name, avatar_url)
            `)
            .eq('team_id', team_id);

        if (error) throw error;

        res.status(200).json({ success: true, data, message: 'Team members retrieved' });
    } catch (error) {
        next(error);
    }
};

// ─── REMOVE MEMBER ────────────────────────────────────────────────────────────
exports.removeMember = async (req, res, next) => {
    try {
        const { team_id, member_id } = req.body;
        const clientId = req.user.id;

        // Verify sender is ADMIN
        const { data: membership, error: memError } = await supabase
            .from('team_members')
            .select('role')
            .eq('team_id', team_id)
            .eq('user_id', clientId)
            .single();

        if (memError || membership?.role !== 'ADMIN') {
            return res.status(403).json({ success: false, data: null, message: 'Not authorized' });
        }

        const { error } = await supabase
            .from('team_members')
            .delete()
            .eq('team_id', team_id)
            .eq('user_id', member_id);

        if (error) throw error;

        res.status(200).json({ success: true, data: null, message: 'Member removed successfully' });
    } catch (error) {
        next(error);
    }
};

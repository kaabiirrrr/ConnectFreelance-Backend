const supabase = require('../supabase/client');
const crypto = require('crypto');
// We would ideally use NodeMailer here to send an actual email invitation with a token
// const mailer = require('../utils/mailer');

exports.createTeam = async (req, res, next) => {
    try {
        const { name } = req.body;
        const clientId = req.user.id; // Only clients create teams

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
            role: 'ADMIN'
        }]);

        res.status(201).json({ success: true, data, message: 'Team created successfully' });
    } catch (error) {
        next(error);
    }
};

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

const mailer = require('../utils/mailer');

exports.inviteMember = async (req, res, next) => {
    try {
        let { team_id, email, role } = req.body;
        const clientId = req.user.id;

        // 1. If no team_id provided, find or create default team
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

                await supabase.from('team_members').insert([{
                    team_id: team_id,
                    user_id: clientId,
                    role: 'ADMIN'
                }]);
            } else {
                team_id = teams[0].id;
            }
        }

        // 2. Gather data for the email
        const [inviterRes, teamRes] = await Promise.all([
            supabase.from('profiles').select('name').eq('user_id', clientId).single(),
            supabase.from('teams').select('name').eq('id', team_id).single()
        ]);

        const inviterName = inviterRes.data?.name || req.user.email;
        const teamName = teamRes.data?.name || "our team";

        // 3. Define permissions for the email template
        const permissionsMap = {
            'MANAGER': [
                'Full job management and lifecycle control',
                'Access to all candidate proposals and interviews',
                'Authority to create and sign contracts',
                'Management of team billing and payments'
            ],
            'RECRUITER': [
                'Post and manage new job listings',
                'Screen and shortlist candidate applications',
                'Direct communication with talent pool',
                'Access to public profile analytics'
            ],
            'MEMBER': [
                'View active project and milestone progress',
                'Collaborate in project-specific chat channels',
                'Submit and review deliverables',
                'Access shared team resources'
            ]
        };

        const assignedRole = (role || 'MEMBER').toUpperCase();
        const permissions = permissionsMap[assignedRole] || permissionsMap['MEMBER'];

        // 4. Verify sender is ADMIN of this team
        const { data: membership, error: memError } = await supabase
            .from('team_members')
            .select('role')
            .eq('team_id', team_id)
            .eq('user_id', clientId)
            .single();

        if (memError || membership.role !== 'ADMIN') {
            return res.status(403).json({ success: false, data: null, message: 'Not authorized to invite members' });
        }

        // 5. Send Email
        await mailer.sendInviteEmail({
            to: email,
            inviterName,
            teamName,
            role: assignedRole,
            permissions
        });

        // 6. Check if user already exists for auto-adding (optional, but good for UX)
        const { data: user } = await supabase.from('users').select('id').eq('email', email).single();
        if (user) {
            const { error: inviteError } = await supabase
                .from('team_members')
                .insert([{ team_id, user_id: user.id, role: assignedRole }]);

            if (!inviteError) {
                await supabase.from('notifications').insert([{
                    user_id: user.id,
                    title: 'Team Invitation',
                    content: `You have been added to ${teamName} by ${inviterName}`,
                    type: 'SYSTEM'
                }]);
            }
        }

        res.status(200).json({ 
            success: true, 
            message: `Invitation email sent to ${email} successfully.` 
        });
        
    } catch (error) {
        next(error);
    }
};

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

        if (uError || !userInTeam) return res.status(403).json({ success: false, data: null, message: 'Access denied' });

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

        if (memError || membership.role !== 'ADMIN') {
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

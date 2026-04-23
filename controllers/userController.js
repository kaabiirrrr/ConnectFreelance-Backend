const supabase = require('../supabase/client');

exports.getProfile = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const { data, error } = await supabase
            .from('profiles')
            .select('*')
            .eq('user_id', userId)
            .single();

        if (error) throw error;

        res.status(200).json({ success: true, data, message: 'Profile retrieved successfully' });
    } catch (error) {
        next(error);
    }
};

exports.updateProfile = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const updateData = req.body;

        const { data, error } = await supabase
            .from('profiles')
            .update(updateData)
            .eq('user_id', userId)
            .select()
            .single();

        if (error) throw error;

        res.status(200).json({ success: true, data, message: 'Profile updated successfully' });
    } catch (error) {
        next(error);
    }
};

const uploadToSupabase = async (file, bucket, folderPath) => {
    const fileName = `${folderPath}/${Date.now()}_${file.originalname}`;
    const { data, error } = await supabase.storage
        .from(bucket)
        .upload(fileName, file.buffer, {
            contentType: file.mimetype,
            upsert: true
        });

    if (error) throw error;

    // Get public URL
    const { data: urlData } = supabase.storage
        .from(bucket)
        .getPublicUrl(fileName);

    return urlData.publicUrl;
};

exports.uploadAvatar = async (req, res, next) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, data: null, message: 'Please upload an image' });
        }

        const userId = req.user.id;
        const bucket = req.user.role?.includes('ADMIN') ? 'admin-avatars' : 'profilephotos';
        const avatarUrl = await uploadToSupabase(req.file, bucket, userId);

        // Update profile with avatar URL
        const { data, error } = await supabase
            .from('profiles')
            .update({ avatar_url: avatarUrl })
            .eq('user_id', userId)
            .select()
            .single();

        if (error) throw error;

        res.status(200).json({ success: true, data, message: 'Avatar uploaded successfully' });
    } catch (error) {
        next(error);
    }
};

exports.uploadDocument = async (req, res, next) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, data: null, message: 'Please upload a document' });
        }

        const userId = req.user.id;
        const documentUrl = await uploadToSupabase(req.file, 'documents', userId);

        res.status(200).json({ success: true, data: { url: documentUrl }, message: 'Document uploaded successfully' });
    } catch (error) {
        next(error);
    }
};
exports.getAllFreelancers = async (req, res, next) => {
    try {
        const { skill, minRating, search } = req.query;

        let query = supabase
            .from('profiles')
            .select('*');

        // Since role is in users table, we'll assume everyone in profiles 
        // with freelancer fields is a freelancer, OR we should join.
        // For simplicity, let's just fetch all where title is not null 
        // or filter by the title/skills if provided.
        if (skill) {
            query = query.contains('skills', [skill]);
        }

        if (search) {
            query = query.or(`name.ilike.%${search}%,title.ilike.%${search}%`);
        }


        const { data, error } = await query.order('created_at', { ascending: false });

        if (error) throw error;

        res.status(200).json({
            success: true,
            data: data || []
        });
    } catch (error) {
        next(error);
    }
};

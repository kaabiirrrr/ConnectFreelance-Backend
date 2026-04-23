const supabase = require('../../supabase/client');
const adminClient = require('../../supabase/adminClient');
const logger = require('../../utils/logger');

// Get all plans (Public — only published)
exports.getPlans = async (req, res) => {
    try {
        const { data: plans, error } = await supabase
            .from('plans')
            .select('*')
            .eq('is_published', true)
            .order('original_price', { ascending: true });

        if (error) {
            logger.error('Error Fetching Plans', error);
            return res.status(500).json({ success: false, message: 'Failed to fetch plans.' });
        }

        res.status(200).json({ success: true, data: plans });
    } catch (error) {
        logger.error('Server error in getPlans', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// Get ALL plans for Admin (including unpublished)
exports.getAllPlansAdmin = async (req, res) => {
    try {
        const { data: plans, error } = await adminClient
            .from('plans')
            .select('*')
            .order('original_price', { ascending: true });

        if (error) {
            logger.error('Error Fetching All Plans', error);
            return res.status(500).json({ success: false, message: 'Failed to fetch plans.' });
        }

        res.status(200).json({ success: true, data: plans });
    } catch (error) {
        logger.error('Server error in getAllPlansAdmin', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// Toggle publish/unpublish a plan
exports.togglePublish = async (req, res) => {
    try {
        const { id } = req.params;
        // First, get current status
        const { data: existing, error: fetchErr } = await adminClient
            .from('plans').select('is_published').eq('id', id).single();
        if (fetchErr || !existing) {
            return res.status(404).json({ success: false, message: 'Plan not found.' });
        }

        const { data: plan, error } = await adminClient
            .from('plans')
            .update({ is_published: !existing.is_published })
            .eq('id', id)
            .select()
            .single();

        if (error) {
            return res.status(500).json({ success: false, message: 'Failed to toggle publish status.' });
        }

        res.status(200).json({ success: true, data: plan });
    } catch (error) {
        logger.error('Server error in togglePublish', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// Create a new plan (Super Admin)
exports.createPlan = async (req, res) => {
    try {
        const { name, original_price, offer_price, duration, features, is_popular, is_published } = req.body;

        if (!name || isNaN(original_price) || isNaN(offer_price) || !duration) {
            return res.status(400).json({ success: false, message: 'Please provide all required fields.' });
        }

        const discount_percentage = original_price > 0 
            ? Math.round(((original_price - offer_price) / original_price) * 100) 
            : 0;

        const { data: plan, error } = await adminClient
            .from('plans')
            .insert([{
                name,
                original_price: Number(original_price),
                offer_price: Number(offer_price),
                discount_percentage,
                duration,
                features: features || [],
                is_popular: Boolean(is_popular),
                is_published: is_published !== undefined ? Boolean(is_published) : true
            }])
            .select()
            .single();

        if (error) {
            logger.error('Error Creating Plan', error);
            return res.status(500).json({ success: false, message: 'Failed to create plan.' });
        }

        res.status(201).json({ success: true, message: 'Plan created successfully.', data: plan });
    } catch (error) {
        logger.error('Server error in createPlan', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// Update a plan (Super Admin)
exports.updatePlan = async (req, res) => {
    try {
        const { id } = req.params;
        const { name, original_price, offer_price, duration, features, is_popular, is_published } = req.body;

        if (!id) {
            return res.status(400).json({ success: false, message: 'Plan ID is required.' });
        }

        let updates = {};
        if (name !== undefined) updates.name = name;
        if (original_price !== undefined) updates.original_price = Number(original_price);
        if (offer_price !== undefined) updates.offer_price = Number(offer_price);
        if (duration !== undefined) updates.duration = duration;
        if (features !== undefined) updates.features = features;
        if (is_popular !== undefined) updates.is_popular = Boolean(is_popular);
        if (is_published !== undefined) updates.is_published = Boolean(is_published);

        // Recalculate discount if prices change
        if (updates.original_price !== undefined || updates.offer_price !== undefined) {
            // Retrieve current plan if needed, but since we usually get the full object, we can just check if both are present in body.
            // Let's first retrieve existing to make sure we have both prices if only one is updated
            const { data: existingPlan, error: fetchError } = await adminClient
                .from('plans')
                .select('original_price, offer_price')
                .eq('id', id)
                .single();

            if (fetchError || !existingPlan) {
                return res.status(404).json({ success: false, message: 'Plan not found.' });
            }

            const currentOriginal = updates.original_price !== undefined ? updates.original_price : existingPlan.original_price;
            const currentOffer = updates.offer_price !== undefined ? updates.offer_price : existingPlan.offer_price;

            updates.discount_percentage = currentOriginal > 0 
                ? Math.round(((currentOriginal - currentOffer) / currentOriginal) * 100) 
                : 0;
        }

        const { data: plan, error } = await adminClient
            .from('plans')
            .update(updates)
            .eq('id', id)
            .select()
            .single();

        if (error) {
            logger.error('Error Updating Plan', error);
            return res.status(500).json({ success: false, message: 'Failed to update plan.' });
        }

        res.status(200).json({ success: true, message: 'Plan updated successfully.', data: plan });
    } catch (error) {
        logger.error('Server error in updatePlan', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// Delete a plan (Super Admin)
exports.deletePlan = async (req, res) => {
    try {
        const { id } = req.params;

        if (!id) {
            return res.status(400).json({ success: false, message: 'Plan ID is required.' });
        }

        const { error } = await adminClient
            .from('plans')
            .delete()
            .eq('id', id);

        if (error) {
            logger.error('Error Deleting Plan', error);
            return res.status(500).json({ success: false, message: 'Failed to delete plan.' });
        }

        res.status(200).json({ success: true, message: 'Plan deleted successfully.' });
    } catch (error) {
        logger.error('Server error in deletePlan', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

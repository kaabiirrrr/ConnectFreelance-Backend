const adminClient = require('../supabase/adminClient');
const multer = require('multer');


const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Multer config for service images
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
    fileFilter: (req, file, cb) => {
        const allowed = ['image/jpeg', 'image/png', 'image/webp'];
        if (allowed.includes(file.mimetype)) cb(null, true);
        else cb(new Error('Only JPG, PNG, or WebP images are allowed'));
    }
});

exports.serviceUpload = upload;


// ─── SERVICES CRUD ────────────────────────────────────────────────────────────

// GET /api/services?category=&search=&freelancer_id=&page=&limit=
exports.getServices = async (req, res, next) => {
    try {
        const { category, search, freelancer_id, page = 1, limit = 20 } = req.query;
        const offset = (Number(page) - 1) * Number(limit);

        let query = adminClient
            .from('services')
            .select('id, title, description, category, price, delivery_days, revisions, tags, images, orders_count, rating, freelancer_id, is_active, created_at', { count: 'exact' })
            .eq('is_active', true);

        if (category) query = query.eq('category', category);
        if (freelancer_id) query = query.eq('freelancer_id', freelancer_id);
        if (search) query = query.or(`title.ilike.%${search}%,description.ilike.%${search}%`);

        const { data, error, count } = await query
            .order('created_at', { ascending: false })
            .range(offset, offset + Number(limit) - 1);

        if (error) throw error;

        // Enrich with freelancer profiles
        const ids = [...new Set((data || []).map(s => s.freelancer_id))];
        const { data: profiles } = ids.length
            ? await adminClient.from('profiles').select('user_id, name, avatar_url, title').in('user_id', ids)
            : { data: [] };
        const pm = Object.fromEntries((profiles || []).map(p => [p.user_id, p]));

        const enriched = (data || []).map(s => ({ ...s, freelancer: pm[s.freelancer_id] || null }));

        res.status(200).json({ success: true, data: enriched, pagination: { total: count || 0, page: Number(page), limit: Number(limit) } });
    } catch (err) {
        next(err);
    }
};

// GET /api/services/my — freelancer's own services (including inactive)
exports.getMyServices = async (req, res, next) => {
    try {
        const freelancerId = req.user.id;
        const { data, error } = await adminClient
            .from('services')
            .select('id, title, description, category, subcategory, price, delivery_days, revisions, tags, is_active, created_at, images, orders_count, rating')
            .eq('freelancer_id', freelancerId)
            .order('created_at', { ascending: false });

        if (error) throw error;
        res.status(200).json({ success: true, data: data || [] });
    } catch (err) {
        next(err);
    }
};

// GET /api/services/:id
exports.getServiceById = async (req, res, next) => {
    try {
        const { id } = req.params;
        if (!UUID_REGEX.test(id)) return res.status(400).json({ success: false, message: 'Invalid service ID' });

        const { data, error } = await adminClient.from('services').select('id, title, description, category, subcategory, price, delivery_days, revisions, tags, images, packages, faqs, orders_count, rating, freelancer_id, is_active, created_at').eq('id', id).maybeSingle();
        if (error) throw error;
        if (!data) return res.status(404).json({ success: false, message: 'Service not found' });

        // Try user_id first, fall back to id column
        let profile = null;
        const { data: p1 } = await adminClient
            .from('profiles')
            .select('user_id, name, avatar_url, title, bio')
            .eq('user_id', data.freelancer_id)
            .maybeSingle();

        if (p1) {
            profile = p1;
        } else {
            // Some schemas use 'id' as the PK on profiles
            const { data: p2 } = await adminClient
                .from('profiles')
                .select('user_id, name, avatar_url, title, bio')
                .eq('id', data.freelancer_id)
                .maybeSingle();
            profile = p2 || null;
        }

        console.log(`[services] getServiceById ${id} — freelancer_id: ${data.freelancer_id}, profile found: ${!!profile}`);

        res.status(200).json({
            success: true,
            data: {
                ...data,
                tags: data.tags || [],
                images: data.images || [],
                packages: data.packages || null,
                faqs: data.faqs || null,
                freelancer: profile || null
            }
        });
    } catch (err) {
        next(err);
    }
};

// POST /api/services — create service
exports.createService = async (req, res, next) => {
    try {
        const freelancerId = req.user.id;
        const { title, description, category, subcategory, price, delivery_days, revisions, tags, images, packages, faqs } = req.body;

        if (!title?.trim()) return res.status(400).json({ success: false, message: 'Title is required' });
        if (!description?.trim()) return res.status(400).json({ success: false, message: 'Description is required' });
        if (!category) return res.status(400).json({ success: false, message: 'Category is required' });
        if (!price || isNaN(price) || Number(price) <= 0) return res.status(400).json({ success: false, message: 'Valid price is required' });

        const { data, error } = await adminClient
            .from('services')
            .insert([{
                freelancer_id: freelancerId,
                title: title.trim(),
                description: description.trim(),
                category,
                subcategory: subcategory || null,
                price: Number(price),
                delivery_days: Number(delivery_days) || 3,
                revisions: Number(revisions) || 1,
                tags: tags || [],
                images: images || [],
                packages: packages || [],
                faqs: faqs || [],
                is_active: true
            }])
            .select('id, title, category, price, is_active')
            .single();

        if (error) throw error;
        res.status(201).json({ success: true, data, message: 'Service published successfully!' });
    } catch (err) {
        next(err);
    }
};

// POST /api/services/upload — upload service image
exports.uploadServiceImage = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const file = req.file;
        if (!file) return res.status(400).json({ success: false, message: 'No file uploaded' });

        const fileExt = file.originalname.split('.').pop();
        const fileName = `services/${userId}_${Date.now()}.${fileExt}`;

        // Upload to 'job-attachments' bucket (or 'services' if you prefer, 
        // but 'job-attachments' is already configured for public access in many setups)
        const { error: uploadError } = await adminClient.storage
            .from('job-attachments')
            .upload(fileName, file.buffer, {
                contentType: file.mimetype,
                upsert: true
            });

        if (uploadError) throw uploadError;

        const { data: urlData } = adminClient.storage
            .from('job-attachments')
            .getPublicUrl(fileName);

        res.status(200).json({
            success: true,
            data: { url: urlData.publicUrl },
            message: 'Image uploaded successfully'
        });
    } catch (err) {
        next(err);
    }
};


// PATCH /api/services/:id — update service
exports.updateService = async (req, res, next) => {
    try {
        const freelancerId = req.user.id;
        const { id } = req.params;
        const updates = req.body;

        delete updates.id;
        delete updates.freelancer_id;
        delete updates.created_at;
        delete updates.orders_count;
        delete updates.rating;

        const { data: existing } = await adminClient.from('services').select('freelancer_id').eq('id', id).maybeSingle();
        if (!existing) return res.status(404).json({ success: false, message: 'Service not found' });
        if (existing.freelancer_id !== freelancerId) return res.status(403).json({ success: false, message: 'Not authorized' });

        const { data, error } = await adminClient.from('services').update(updates).eq('id', id).select('id, title, category, price, is_active').single();
        if (error) throw error;
        res.status(200).json({ success: true, data, message: 'Service updated' });
    } catch (err) {
        next(err);
    }
};

// DELETE /api/services/:id
exports.deleteService = async (req, res, next) => {
    try {
        const freelancerId = req.user.id;
        const { id } = req.params;

        const { data: existing } = await adminClient.from('services').select('freelancer_id').eq('id', id).maybeSingle();
        if (!existing) return res.status(404).json({ success: false, message: 'Service not found' });
        if (existing.freelancer_id !== freelancerId) return res.status(403).json({ success: false, message: 'Not authorized' });

        await adminClient.from('services').delete().eq('id', id);
        res.status(200).json({ success: true, message: 'Service deleted' });
    } catch (err) {
        next(err);
    }
};

// ─── SERVICE ORDERS ───────────────────────────────────────────────────────────

// POST /api/services/:id/order — client places an order
exports.placeOrder = async (req, res, next) => {
    try {
        const clientId = req.user.id;
        const { id: serviceId } = req.params;
        const { package_name, requirements } = req.body;

        const { data: service } = await adminClient.from('services').select('id, title, freelancer_id, price, delivery_days, packages, is_active, orders_count').eq('id', serviceId).maybeSingle();
        if (!service || !service.is_active) return res.status(404).json({ success: false, message: 'Service not found' });
        if (service.freelancer_id === clientId) return res.status(400).json({ success: false, message: 'Cannot order your own service' });

        // Find package price if specified
        let price = service.price;
        let delivery_days = service.delivery_days;
        if (package_name && service.packages) {
            const pkg = service.packages.find(p => p.name === package_name);
            if (pkg) { price = pkg.price; delivery_days = pkg.delivery_days; }
        }

        const { data, error } = await adminClient
            .from('service_orders')
            .insert([{
                service_id: serviceId,
                client_id: clientId,
                freelancer_id: service.freelancer_id,
                package_name: package_name || null,
                price,
                delivery_days,
                requirements: requirements || null,
                status: 'PENDING'
            }])
            .select('id, service_id, client_id, freelancer_id, status, price, delivery_days')
            .single();

        if (error) throw error;

        // Notify freelancer
        await adminClient.from('notifications').insert([{
            user_id: service.freelancer_id,
            title: 'New Service Order',
            content: `You have a new order for "${service.title}"`,
            type: 'CONTRACT_UPDATE',
            link: `/freelancer/services/orders/${data.id}`
        }]);

        // Increment orders count
        await adminClient.from('services').update({ orders_count: (service.orders_count || 0) + 1 }).eq('id', serviceId);

        res.status(201).json({ success: true, data, message: 'Order placed successfully' });
    } catch (err) {
        next(err);
    }
};

// GET /api/services/orders — get my orders (client or freelancer)
exports.getMyOrders = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const role = req.user.role;
        const field = role === 'CLIENT' ? 'client_id' : 'freelancer_id';

        const { data, error } = await adminClient
            .from('service_orders')
            .select('id, service_id, client_id, freelancer_id, status, price, delivery_days, created_at, service:services(title, images, category)')
            .eq(field, userId)
            .order('created_at', { ascending: false });

        if (error) throw error;

        // Enrich with other party profile
        const otherIds = [...new Set((data || []).map(o => role === 'CLIENT' ? o.freelancer_id : o.client_id))];
        const { data: profiles } = otherIds.length
            ? await adminClient.from('profiles').select('user_id, name, avatar_url').in('user_id', otherIds)
            : { data: [] };
        const pm = Object.fromEntries((profiles || []).map(p => [p.user_id, p]));

        const enriched = (data || []).map(o => ({
            ...o,
            other_party: pm[role === 'CLIENT' ? o.freelancer_id : o.client_id] || null
        }));

        res.status(200).json({ success: true, data: enriched });
    } catch (err) {
        next(err);
    }
};

// PATCH /api/services/orders/:id/status — update order status
exports.updateOrderStatus = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const { id } = req.params;
        const { status } = req.body;

        const allowed = ['IN_PROGRESS', 'DELIVERED', 'REVISION', 'COMPLETED', 'CANCELLED'];
        if (!allowed.includes(status)) return res.status(400).json({ success: false, message: `Status must be one of: ${allowed.join(', ')}` });

        const { data: order } = await adminClient.from('service_orders').select('id, client_id, freelancer_id, status').eq('id', id).maybeSingle();
        if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
        if (order.client_id !== userId && order.freelancer_id !== userId) return res.status(403).json({ success: false, message: 'Not authorized' });

        const updates = { status };
        if (status === 'DELIVERED') updates.delivered_at = new Date().toISOString();
        if (status === 'COMPLETED') updates.completed_at = new Date().toISOString();

        const { data, error } = await adminClient.from('service_orders').update(updates).eq('id', id).select('id, status, delivered_at, completed_at').single();
        if (error) throw error;

        const notifyId = userId === order.freelancer_id ? order.client_id : order.freelancer_id;
        await adminClient.from('notifications').insert([{
            user_id: notifyId,
            title: `Order ${status}`,
            content: `Your service order has been marked as ${status.toLowerCase()}.`,
            type: 'CONTRACT_UPDATE'
        }]);

        res.status(200).json({ success: true, data });
    } catch (err) {
        next(err);
    }
};

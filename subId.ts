import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import { verifyAdminToken } from '../../../lib/auth';

const supabase = createClient(
  process.env.SUPABASE_URL || 'https://aunkcnmplnunnercrvni.supabase.co',
  process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY || ''
);

const BUCKET = process.env.SUPABASE_BUCKET || 'cvs';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Auth check
  const token = req.headers.authorization?.replace('Bearer ', '') || req.cookies?.admin_token || '';
  const isValid = await verifyAdminToken(token);
  if (!isValid) {
    return res.status(401).json({ success: false, error: 'Authentication required' });
  }

  const { subId } = req.query;
  if (!subId || typeof subId !== 'string') {
    return res.status(400).json({ success: false, error: 'Invalid submission ID' });
  }

  // GET — fetch submission + optionally generate signed CV URL
  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('submissions')
      .select('*')
      .eq('id', subId)
      .single();

    if (error || !data) {
      return res.status(404).json({ success: false, error: 'Submission not found' });
    }

    // If action=cv_url, generate a signed URL
    if (req.query.action === 'cv_url' && data.cv_path) {
      try {
        const filename = data.cv_path.split(`/${BUCKET}/`).pop() || data.cv_path.split('/').pop();
        const { data: signedData, error: signedError } = await supabase
          .storage
          .from(BUCKET)
          .createSignedUrl(filename, 3600); // 1 hour

        if (signedError) throw signedError;

        return res.status(200).json({
          success: true,
          cv_url: signedData.signedUrl,
        });
      } catch (e: any) {
        // Fallback: return the raw path
        return res.status(200).json({
          success: true,
          cv_url: data.cv_path,
          warning: 'Could not generate signed URL: ' + e.message,
        });
      }
    }

    return res.status(200).json({ success: true, submission: data });
  }

  // PATCH — update status
  if (req.method === 'PATCH') {
    const { status } = req.body;
    if (!['pending', 'accepted', 'rejected'].includes(status)) {
      return res.status(400).json({ success: false, error: 'Invalid status' });
    }

    const { error } = await supabase
      .from('submissions')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', subId);

    if (error) {
      return res.status(500).json({ success: false, error: error.message });
    }

    return res.status(200).json({ success: true, status });
  }

  return res.status(405).json({ success: false, error: 'Method not allowed' });
}

#!/bin/bash

echo "🔄 Opening Supabase SQL Editor..."
echo ""
echo "📋 Copy this SQL and paste it in the editor:"
echo ""
cat supabase/migrations/20251024000000_add_user_profile_fields.sql
echo ""
echo "Opening browser..."

# Open Supabase SQL Editor
open "https://supabase.com/dashboard/project/qiqeyirtpstdjkkeyfss/sql/new"

# Also copy SQL to clipboard if pbcopy is available
if command -v pbcopy &> /dev/null; then
    cat supabase/migrations/20251024000000_add_user_profile_fields.sql | pbcopy
    echo "✓ SQL copied to clipboard!"
    echo "Just paste (Cmd+V) in the SQL Editor and click Run"
fi

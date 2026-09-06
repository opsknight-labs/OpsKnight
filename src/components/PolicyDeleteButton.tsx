'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/hooks/use-product-notification';
import { deletePolicy } from '@/app/(app)/policies/actions';

type PolicyDeleteButtonProps = {
    policyId: string;
    servicesUsingPolicy: Array<{ id: string; name: string }>;
};

export default function PolicyDeleteButton({ policyId, servicesUsingPolicy }: PolicyDeleteButtonProps) {
    const [isPending, startTransition] = useTransition();
    const { showToast } = useToast();
    const router = useRouter();

    const handleDelete = async () => {
        if (servicesUsingPolicy.length > 0) {
            const serviceNames = servicesUsingPolicy.map(s => s.name).join(', ');
            showToast(
                `Cannot delete policy: ${servicesUsingPolicy.length} service(s) are using this policy (${serviceNames}). Please reassign or remove the policy from those services first.`,
                'error'
            );
            return;
        }

        if (!confirm('Are you sure you want to delete this policy? This action cannot be undone.')) {
            return;
        }

        startTransition(async () => {
            try {
                await deletePolicy(policyId);
                showToast('Policy deleted successfully', 'success');
                router.push('/policies');
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : 'Failed to delete policy';
                showToast(errorMessage, 'error');
            }
        });
    };

    return (
        <div className="glass-panel" style={{
            padding: '1.5rem',
            background: 'linear-gradient(135deg, #fee2e2 0%, #fecaca 100%)',
            border: '1px solid #fecaca',
            borderRadius: '12px',
            marginTop: '2rem'
        }}>
            <h3 style={{ fontSize: '1.1rem', fontWeight: '600', marginBottom: '0.5rem', color: '#991b1b' }}>
                Danger Zone
            </h3>
            {servicesUsingPolicy.length > 0 ? (
                <>
                    <p style={{ fontSize: '0.85rem', color: '#7f1d1d', marginBottom: '0.75rem' }}>
                        This policy cannot be deleted because it is currently assigned to {servicesUsingPolicy.length} service(s):
                    </p>
                    <ul style={{ 
                        fontSize: '0.85rem', 
                        color: '#7f1d1d', 
                        marginBottom: '1rem',
                        paddingLeft: '1.5rem',
                        listStyle: 'disc'
                    }}>
                        {servicesUsingPolicy.map(service => (
                            <li key={service.id} style={{ marginBottom: '0.25rem' }}>
                                <a 
                                    href={`/services/${service.id}`}
                                    style={{ 
                                        color: '#991b1b', 
                                        textDecoration: 'underline',
                                        fontWeight: '500'
                                    }}
                                >
                                    {service.name}
                                </a>
                            </li>
                        ))}
                    </ul>
                    <p style={{ fontSize: '0.85rem', color: '#7f1d1d', marginBottom: '1rem' }}>
                        Please reassign or remove the policy from these services before deleting.
                    </p>
                    <button
                        type="button"
                        disabled
                        style={{
                            width: '100%',
                            padding: '0.6rem',
                            background: '#9ca3af',
                            color: 'white',
                            border: 'none',
                            borderRadius: '8px',
                            fontSize: '0.9rem',
                            fontWeight: '600',
                            cursor: 'not-allowed',
                            opacity: 0.6
                        }}
                    >
                        Delete Policy (Disabled - Policy in Use)
                    </button>
                </>
            ) : (
                <>
                    <p style={{ fontSize: '0.85rem', color: '#7f1d1d', marginBottom: '1rem' }}>
                        Deleting this policy will remove it from all services. This action cannot be undone.
                    </p>
                    <button
                        type="button"
                        onClick={handleDelete}
                        disabled={isPending}
                        style={{
                            width: '100%',
                            padding: '0.6rem',
                            background: isPending ? '#9ca3af' : '#dc2626',
                            color: 'white',
                            border: 'none',
                            borderRadius: '8px',
                            fontSize: '0.9rem',
                            fontWeight: '600',
                            cursor: isPending ? 'not-allowed' : 'pointer',
                            opacity: isPending ? 0.6 : 1
                        }}
                    >
                        {isPending ? 'Deleting...' : 'Delete Policy'}
                    </button>
                </>
            )}
        </div>
    );
}










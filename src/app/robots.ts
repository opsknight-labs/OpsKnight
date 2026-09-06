import { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
    return {
        rules: [
            {
                userAgent: '*',
                allow: '/',
                disallow: ['/api/', '/login', '/setup', '/set-password'],
            },
        ],
        sitemap: `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/sitemap.xml`,
    };
}


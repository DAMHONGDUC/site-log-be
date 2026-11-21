// Every HTTP and WebSocket path of 01-api §3, in one place. Routes register these templates;
// tests and scripts build concrete paths with the helpers, never by hand.
export class ApiRoutes {
  static readonly HEALTH = '/health';
  static readonly ACCOUNT = '/account';

  static readonly SYNC_PULL = '/sync/pull';
  static readonly SYNC_PUSH = '/sync/push';

  static readonly UPLOADS = '/uploads';
  static readonly UPLOAD = '/uploads/:id';
  static readonly UPLOAD_COMPLETE = '/uploads/:id/complete';
  static readonly UPLOAD_PARTS_REFRESH = '/uploads/:id/parts/refresh';
  static readonly MEDIA_URLS = '/media/urls';

  static readonly VERIFY = '/verify/:code';
  static readonly WEBSOCKET = '/ws';
  // OpenAPI explorer, outside production only.
  static readonly DOCS = '/docs';

  static readonly DEVICES = '/devices';
  static readonly DEVICE = '/devices/:token';

  static readonly ME = '/me';
  static readonly MEMBERS = '/members';
  static readonly MEMBER = '/members/:uid';
  static readonly INVITATIONS = '/invitations';
  static readonly INVITATION = '/invitations/:id';
  static readonly INVITATION_PREVIEW = '/invitations/:token';
  static readonly INVITATION_ACCEPT = '/invitations/accept';
  static readonly INVITATION_RESEND = '/invitations/:id/resend';
  static readonly PROJECT_MEMBERS = '/projects/:id/members';
  static readonly MEMBER_EVENTS = '/member-events';

  // Fills ":name" placeholders: ApiRoutes.path(ApiRoutes.UPLOAD, { id }) → "/uploads/<id>".
  static path(template: string, params: Record<string, string>): string {
    return template.replace(/:([A-Za-z]+)/g, (_match, name: string) => {
      const value = params[name];
      if (value === undefined) {
        throw new Error(`Missing route parameter "${name}" for ${template}`);
      }
      return encodeURIComponent(value);
    });
  }

  static upload(id: string): string {
    return ApiRoutes.path(ApiRoutes.UPLOAD, { id });
  }

  static uploadComplete(id: string): string {
    return ApiRoutes.path(ApiRoutes.UPLOAD_COMPLETE, { id });
  }

  static uploadPartsRefresh(id: string): string {
    return ApiRoutes.path(ApiRoutes.UPLOAD_PARTS_REFRESH, { id });
  }

  static verify(code: string): string {
    return ApiRoutes.path(ApiRoutes.VERIFY, { code });
  }

  static device(token: string): string {
    return ApiRoutes.path(ApiRoutes.DEVICE, { token });
  }

  static member(uid: string): string {
    return ApiRoutes.path(ApiRoutes.MEMBER, { uid });
  }

  static invitation(id: string): string {
    return ApiRoutes.path(ApiRoutes.INVITATION, { id });
  }

  static invitationPreview(token: string): string {
    return ApiRoutes.path(ApiRoutes.INVITATION_PREVIEW, { token });
  }

  static invitationResend(id: string): string {
    return ApiRoutes.path(ApiRoutes.INVITATION_RESEND, { id });
  }

  static projectMembers(id: string): string {
    return ApiRoutes.path(ApiRoutes.PROJECT_MEMBERS, { id });
  }
}

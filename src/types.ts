export interface ILinkMessageItem {
  type?: number;
  text_item?: {
    text?: string;
  };
}

export interface ILinkMessage {
  from_user_id: string;
  context_token?: string;
  create_time_ms?: number;
  message_type: number;
  item_list?: ILinkMessageItem[];
}

export interface ILinkGetUpdatesResponse {
  msgs?: ILinkMessage[];
  get_updates_buf?: string;
}

export interface FamilyMember {
  id: string;
  parentId: string | null;
  spouseId: string | null;
  familyName: string;
  generation: number;
  name: string;
  nickName?: string;
  relation: string;
  birthYear: number | null;
  birthdayType: "solar" | "lunar";
  birthMonth: number;
  birthDay: number;
}
